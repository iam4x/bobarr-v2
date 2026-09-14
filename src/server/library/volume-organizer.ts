import type { StorageVolume } from "../../contracts";
import type { IntegrationResolver } from "../api/integration-resolver";
import type { BackendDatabase, Repositories } from "../db";
import type { VolumeTransfer } from "../db/volume-transfers";
import type { EventHub } from "../events";
import type { GroupInventory } from "./volume-inventory";

import { lstat, readdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { inventoryLibrary, validateDirectory } from "./volume-inventory";
import { listLibraryGroups } from "./volume-placement";
import { buildVolumeTransfer, resumeVolumeTransfer } from "./volume-transfer";
import {
  activeVolumeTransfers,
  isMediaMutating,
  isStorageMutating,
  saveVolumeTransfer,
} from "../db/volume-transfers";
import { JobDeferredError } from "../jobs";
import {
  measureFreeBytes,
  STORAGE_RESERVE_BYTES,
  storageRootsOverlap,
  storageVolumesEqual,
} from "../storage";

export const ORGANIZE_VOLUMES_JOB = "library.organize.v1";

export interface VolumeOrganizerOptions {
  database: BackendDatabase;
  repositories: Repositories;
  integrations: Pick<IntegrationResolver, "transmission">;
  events?: EventHub;
  measureFreeBytes?: typeof measureFreeBytes;
  deviceForPath?: (path: string) => Promise<number>;
}

export interface VolumeOrganizationContext {
  jobId: string;
  signal: AbortSignal;
  heartbeat: () => Promise<void>;
}

export function createVolumeOrganizer(options: VolumeOrganizerOptions) {
  let running = false;
  return {
    async organize(context: VolumeOrganizationContext): Promise<void> {
      if (running) throw new Error("Volume organization is already running");
      running = true;
      let movedGroups = 0;
      let movedBytes = 0n;
      const skipped = new Map<string, string>();
      const completedGroups = new Set<string>();
      const retainedStagingPaths = new Set<string>();
      const transmission = () => options.integrations.transmission();
      const skippedGroup = (key: string, reason: string): void => {
        skipped.set(key, reason);
      };
      const reportRetainedCopies = (transfer: VolumeTransfer): void => {
        const paths = [
          ...new Set(
            transfer.files.flatMap((file) => file.retainedStagingPaths),
          ),
        ];
        if (paths.length === 0) return;
        for (const path of paths) retainedStagingPaths.add(path);
        activity(
          options,
          "library.organize.retained",
          "warning",
          `Previous copy attempts still occupy destination space. Inspect these files and verify their contents before removing any retained data: ${paths.join("; ")}`,
          { paths },
        );
      };
      try {
        for (const transfer of activeVolumeTransfers(options.database)) {
          await resumeVolumeTransfer({
            ...context,
            transfer,
            database: options.database,
            transmission,
            measureFreeBytes: options.measureFreeBytes,
            deviceForPath: options.deviceForPath,
          });
          completedGroups.add(transfer.groupKey);
          movedGroups += transfer.groupKeys.length;
          reportRetainedCopies(transfer);
          publishChanges(options);
        }
        while (true) {
          context.signal.throwIfAborted();
          await context.heartbeat();
          if (isStorageMutating(options.database))
            throw new JobDeferredError(
              "Storage settings are being changed; organization will retry",
            );
          const volumes =
            options.repositories.settings.ensureDefaults().settings.storage
              .volumes;
          if (await storageRootsOverlap(volumes))
            throw new Error("Configured storage paths overlap on disk");
          const free = new Map<string, bigint>();
          for (const volume of volumes) {
            for (const root of [
              volume.downloadsPath,
              volume.moviesPath,
              volume.televisionPath,
            ])
              await validateDirectory(root, root);
            const bytes = await (options.measureFreeBytes ?? measureFreeBytes)(
              volume.downloadsPath,
            );
            if (bytes === null)
              throw new Error(
                `Storage volume could not be measured: ${volume.label}`,
              );
            free.set(volume.id, bytes);
          }
          const groups = await inventoryLibrary({
            ...options,
            volumes,
            transmission,
            ...context,
            skipped: skippedGroup,
          });
          const usedBytes = await measureVolumeBytes(volumes, context.signal);
          const move = chooseVolumeMove(
            groups,
            volumes,
            free,
            completedGroups,
            usedBytes,
          );
          if (!move) break;
          let transfer;
          try {
            transfer = await buildVolumeTransfer({
              group: move.group,
              volumes,
              destination: move.destination,
              jobId: context.jobId,
              measureFreeBytes: options.measureFreeBytes,
              deviceForPath: options.deviceForPath,
            });
          } catch (error) {
            context.signal.throwIfAborted();
            skippedGroup(
              move.group.key,
              error instanceof Error
                ? error.message
                : "Could not plan this transfer",
            );
            completedGroups.add(move.group.key);
            continue;
          }
          if (
            isStorageMutating(options.database) ||
            !storageVolumesEqual(
              volumes,
              options.repositories.settings.ensureDefaults().settings.storage
                .volumes,
            )
          ) {
            throw new JobDeferredError(
              "Storage settings changed while organization was being planned",
            );
          }
          if (
            !groupUnchanged(move.group, options) ||
            isMediaMutating(options.database, move.group.mediaIds)
          ) {
            skippedGroup(
              move.group.key,
              "A download or library change started while this group was being inspected",
            );
            completedGroups.add(move.group.key);
            continue;
          }
          saveVolumeTransfer(options.database, transfer);
          activity(
            options,
            "library.organize.moving",
            "info",
            `Organizing ${move.group.title} onto ${move.destination.label}`,
            { groupKey: move.group.key, volumeId: move.destination.id },
          );
          await resumeVolumeTransfer({
            ...context,
            transfer,
            database: options.database,
            transmission,
            measureFreeBytes: options.measureFreeBytes,
            deviceForPath: options.deviceForPath,
          });
          completedGroups.add(move.group.key);
          movedGroups += move.group.groups.length;
          movedBytes += move.bytes;
          reportRetainedCopies(transfer);
          publishChanges(options);
        }
        for (const [groupKey, reason] of skipped)
          activity(
            options,
            "library.organize.skipped",
            "warning",
            `Skipped ${groupKey}: ${reason}`,
            { groupKey, reason },
          );
        activity(
          options,
          "library.organize.completed",
          skipped.size > 0 || retainedStagingPaths.size > 0
            ? "warning"
            : "success",
          `Volume organization moved ${movedGroups} movie or season groups${skipped.size > 0 ? ` and skipped ${skipped.size}` : ""}`,
          {
            movedGroups,
            movedBytes: Number(movedBytes),
            skippedGroups: skipped.size,
            retainedStagingFiles: retainedStagingPaths.size,
          },
        );
        publishChanges(options);
      } finally {
        running = false;
      }
    },
  };
}

export function chooseVolumeMove(
  groups: readonly GroupInventory[],
  volumes: readonly StorageVolume[],
  free: ReadonlyMap<string, bigint>,
  excluded: ReadonlySet<string> = new Set(),
  usedBytes?: ReadonlyMap<string, bigint>,
): { group: GroupInventory; destination: StorageVolume; bytes: bigint } | null {
  if (volumes.length < 2) return null;
  const load = new Map(volumes.map((volume) => [volume.id, 0n]));
  for (const group of groups)
    for (const [id, bytes] of group.bytesByVolume)
      load.set(id, (load.get(id) ?? 0n) + bytes);
  for (const [id, bytes] of usedBytes ?? [])
    load.set(id, bytes > (load.get(id) ?? 0n) ? bytes : load.get(id)!);
  const before = imbalance([...load.values()]);
  let selected: {
    group: GroupInventory;
    destination: StorageVolume;
    bytes: bigint;
    improvement: bigint;
    split: boolean;
  } | null = null;
  for (const group of groups) {
    if (excluded.has(group.key)) continue;
    const sourceVolumes = new Set([
      ...group.files.map((file) => file.volumeId),
      ...group.downloads.map((download) => download.volumeId),
    ]);
    const split = sourceVolumes.size > 1;
    const total = [...group.bytesByVolume.values()].reduce(
      (sum, bytes) => sum + bytes,
      0n,
    );
    for (const destination of volumes) {
      if (sourceVolumes.size === 1 && sourceVolumes.has(destination.id))
        continue;
      const bytes = total - (group.bytesByVolume.get(destination.id) ?? 0n);
      if ((free.get(destination.id) ?? 0n) - bytes < STORAGE_RESERVE_BYTES)
        continue;
      const after = new Map(load);
      for (const [id, groupBytes] of group.bytesByVolume)
        after.set(id, (after.get(id) ?? 0n) - groupBytes);
      after.set(destination.id, (after.get(destination.id) ?? 0n) + total);
      const improvement = before - imbalance([...after.values()]);
      if (!split && improvement <= 0n) continue;
      if (
        !selected ||
        (split && !selected.split) ||
        (split === selected.split &&
          (improvement > selected.improvement ||
            (improvement === selected.improvement && bytes < selected.bytes)))
      )
        selected = { group, destination, bytes, improvement, split };
    }
  }
  if (selected) return selected;
  const candidates = groups
    .filter(
      (group) => !excluded.has(group.key) && group.bytesByVolume.size === 1,
    )
    .map((group) => ({
      group,
      source: volumes.find((volume) => group.bytesByVolume.has(volume.id)),
      bytes: [...group.bytesByVolume.values()][0] ?? 0n,
    }))
    .filter((candidate) => candidate.source !== undefined)
    .sort((left, right) => {
      if (left.bytes < right.bytes) return -1;
      return left.bytes > right.bytes ? 1 : 0;
    });
  const byVolume = new Map(
    volumes.map((volume) => [
      volume.id,
      candidates.filter((candidate) => candidate.source?.id === volume.id),
    ]),
  );
  let swap: {
    group: GroupInventory;
    destination: StorageVolume;
    bytes: bigint;
    improvement: bigint;
    transferBytes: bigint;
  } | null = null;
  for (const first of candidates) {
    const source = first.source;
    if (!source) continue;
    for (const destination of volumes) {
      if (
        source.id === destination.id ||
        (free.get(destination.id) ?? 0n) - first.bytes < STORAGE_RESERVE_BYTES
      )
        continue;
      const peers = byVolume.get(destination.id) ?? [];
      const target =
        first.bytes -
        ((load.get(source.id) ?? 0n) - (load.get(destination.id) ?? 0n)) / 2n;
      let low = 0;
      let high = peers.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        const peer = peers[middle];
        if (peer && peer.bytes < target) low = middle + 1;
        else high = middle;
      }
      for (const second of peers.slice(Math.max(0, low - 1), low + 1)) {
        if ((free.get(source.id) ?? 0n) - second.bytes < STORAGE_RESERVE_BYTES)
          continue;
        const after = new Map(load);
        after.set(
          source.id,
          (after.get(source.id) ?? 0n) - first.bytes + second.bytes,
        );
        after.set(
          destination.id,
          (after.get(destination.id) ?? 0n) + first.bytes - second.bytes,
        );
        const improvement = before - imbalance([...after.values()]);
        const transferBytes = first.bytes + second.bytes;
        if (
          improvement > 0n &&
          (!swap ||
            improvement > swap.improvement ||
            (improvement === swap.improvement &&
              transferBytes < swap.transferBytes))
        ) {
          swap = {
            group: first.group,
            destination,
            bytes: first.bytes,
            improvement,
            transferBytes,
          };
        }
      }
    }
  }
  return swap;
}

function imbalance(loads: readonly bigint[]): bigint {
  const sum = loads.reduce((value, load) => value + load, 0n);
  const count = BigInt(loads.length);
  return loads.reduce((value, load) => {
    const difference = count * load - sum;
    return value + difference * difference;
  }, 0n);
}

export async function measureVolumeBytes(
  volumes: readonly StorageVolume[],
  signal: AbortSignal,
): Promise<Map<string, bigint>> {
  const result = new Map<string, bigint>();
  for (const volume of volumes) {
    const counted = new Set<string>();
    let bytes = 0n;
    const directories = await Promise.all(
      [volume.downloadsPath, volume.moviesPath, volume.televisionPath].map(
        (path) => realpath(path),
      ),
    );
    while (directories.length > 0) {
      signal.throwIfAborted();
      const directory = directories.pop()!;
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        signal.throwIfAborted();
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== ".bobarr-volume-organize") directories.push(path);
        } else if (entry.isFile()) {
          const info = await lstat(path).catch((error: unknown) => {
            if (
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            )
              return null;
            throw error;
          });
          if (!info?.isFile()) continue;
          const identity = `${info.dev}:${info.ino}`;
          if (counted.has(identity)) continue;
          counted.add(identity);
          bytes += BigInt(info.size);
        }
      }
    }
    result.set(volume.id, bytes);
  }
  return result;
}

function groupUnchanged(
  group: GroupInventory,
  options: VolumeOrganizerOptions,
): boolean {
  const keys = new Set(group.groups.map((item) => item.key));
  const current = listLibraryGroups(options.repositories)
    .filter((item) => keys.has(item.key))
    .flatMap((item) => item.files);
  if (current.length !== group.libraryFiles.length) return false;
  const original = new Map(
    group.libraryFiles.map((file) => [file.id, file.path]),
  );
  if (current.some((file) => original.get(file.id) !== file.path)) return false;
  const ids = new Set(group.groups.flatMap((item) => item.mediaIds));
  const linkedIds = new Set(
    group.libraryFiles.flatMap((file) =>
      file.downloadId === null ? [] : [file.downloadId],
    ),
  );
  const downloads = options.database.sqlite
    .query<
      {
        id: string;
        media_item_id: string | null;
        acquisition_state: string | null;
        state: string;
        download_directory: string | null;
        download_path: string | null;
      },
      []
    >(
      "SELECT id, media_item_id, acquisition_state, state, download_directory, download_path FROM downloads",
    )
    .all();
  for (const download of downloads) {
    if (
      !linkedIds.has(download.id) &&
      !(download.media_item_id !== null && ids.has(download.media_item_id))
    )
      continue;
    if (
      !["organized", "removed"].includes(download.acquisition_state ?? "") &&
      !["completed", "removed"].includes(download.state)
    )
      return false;
    const captured = group.downloads.find((item) => item.id === download.id);
    const path = download.download_directory ?? download.download_path;
    if (captured && (path === null || resolve(path) !== captured.source))
      return false;
    if (!captured && path !== null && download.state !== "removed")
      return false;
  }
  return true;
}

function activity(
  options: VolumeOrganizerOptions,
  type: string,
  level: "info" | "warning" | "success",
  message: string,
  data: Record<string, unknown>,
): void {
  const event = options.repositories.activity.append({
    type,
    level,
    message,
    data,
    entityId: null,
    entityType: null,
  });
  options.events?.publish("activity.created", { id: event.id });
}

function publishChanges(options: VolumeOrganizerOptions): void {
  options.events?.publish("library.changed", { reason: "volumes-organized" });
  options.events?.publish("snapshot.invalidated", {
    resources: ["library", "downloads", "activity", "jobs"],
  });
}
