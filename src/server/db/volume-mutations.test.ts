import type { AppSettings } from "../../contracts";

import { describe, expect, test } from "bun:test";

import { createRepositories, openBackendDatabase } from "./index";
import {
  VolumeMutationConflictError,
  withMediaMutation,
  withStorageMutation,
} from "./volume-transfers";
import { createAcquisitionService } from "../application/acquisition-service";
import { candidateRepositoryFromDatabase } from "../application/adapters";
import { createAesCandidateCipher } from "../application/candidate-cipher";
import { downloadRepositoryFromDatabase } from "../application/download-repository-adapter";
import { createSqliteJobQueue } from "../jobs";
import { createDownloadPlacement } from "../library/volume-placement";

describe("volume mutation reservations", () => {
  test("keeps storage settings stable while placing a manual download", async () => {
    const database = await openBackendDatabase(":memory:");
    const repositories = createRepositories(database);
    const queue = createSqliteJobQueue({ database: database.sqlite });
    const measuring = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const volumes: AppSettings["storage"]["volumes"] = [
      {
        id: "a",
        label: "a",
        downloadsPath: "/media-a/downloads",
        moviesPath: "/media-a/movies",
        televisionPath: "/media-a/tv",
      },
      {
        id: "b",
        label: "b",
        downloadsPath: "/media-b/downloads",
        moviesPath: "/media-b/movies",
        televisionPath: "/media-b/tv",
      },
    ];
    repositories.settings.update({
      storage: { volumes, organizationStrategy: "copy" },
    });
    const placement = createDownloadPlacement({
      database,
      repositories,
      measure: async (path) => {
        measuring.resolve();
        await resume.promise;
        return (path.includes("media-b") ? 200n : 100n) * 1024n ** 3n;
      },
    });
    const unavailable = async (): Promise<never> => {
      throw new Error("Unexpected integration call");
    };
    const service = createAcquisitionService(
      {
        indexer: { search: unavailable, fetchMetainfo: unavailable },
        torrentEngine: {
          add: unavailable,
          get: unavailable,
          list: unavailable,
          selectFiles: unavailable,
          start: unavailable,
          pause: unavailable,
          remove: unavailable,
        },
        candidateRepository: candidateRepositoryFromDatabase(
          repositories.releases,
        ),
        candidateCipher: createAesCandidateCipher({
          key: new Uint8Array(32).fill(9),
        }),
        downloadRepository: downloadRepositoryFromDatabase(database),
        jobQueue: queue,
      },
      placement,
    );
    const pending = service.startFromMagnet({
      magnetUri: "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
      target: { kind: "movie", title: "Manual" },
    });
    try {
      await measuring.promise;
      await expect(
        withStorageMutation(database, async () =>
          repositories.settings.update({
            storage: {
              volumes: [volumes[0]],
              organizationStrategy: "copy",
            },
          }),
        ),
      ).rejects.toBeInstanceOf(VolumeMutationConflictError);
      resume.resolve();
      const download = await pending;
      expect(download.downloadDirectory).toStartWith("/media-b/downloads/");
      expect(
        repositories.settings.ensureDefaults().settings.storage.volumes,
      ).toEqual(volumes);
      await expect(
        withStorageMutation(database, async () => "released"),
      ).resolves.toBe("released");
    } finally {
      resume.resolve();
      await pending;
      queue.close();
      database.close();
    }
  });

  test("allows unrelated media changes while reserving every active operation", async () => {
    const database = await openBackendDatabase(":memory:");
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const manual = Promise.withResolvers<void>();
    const entered: string[] = [];
    const changes = [
      withMediaMutation(database, ["movie-a"], async () => {
        entered.push("movie-a");
        await first.promise;
      }),
      withMediaMutation(database, ["movie-b"], async () => {
        entered.push("movie-b");
        await second.promise;
      }),
      withMediaMutation(database, [], async () => {
        entered.push("manual");
        await manual.promise;
      }),
    ];
    try {
      expect(entered).toEqual(["movie-a", "movie-b", "manual"]);
      await expect(
        withMediaMutation(database, ["movie-a"], async () => undefined),
      ).rejects.toBeInstanceOf(VolumeMutationConflictError);
      first.resolve();
      second.resolve();
      await Promise.all(changes.slice(0, 2));
      await expect(
        withStorageMutation(database, async () => undefined),
      ).rejects.toBeInstanceOf(VolumeMutationConflictError);
      manual.resolve();
      await Promise.all(changes);
      await expect(
        withStorageMutation(database, async () => "released"),
      ).resolves.toBe("released");
    } finally {
      first.resolve();
      second.resolve();
      manual.resolve();
      await Promise.all(changes);
      database.close();
    }
  });

  test("releases media and storage reservations after an operation throws", async () => {
    const database = await openBackendDatabase(":memory:");
    try {
      for (const mediaIds of [[], ["movie-a"]]) {
        await expect(
          withMediaMutation(database, mediaIds, async () => {
            throw new Error("Placement failed");
          }),
        ).rejects.toThrow("Placement failed");
        await expect(
          withMediaMutation(database, mediaIds, async () => "released"),
        ).resolves.toBe("released");
        await expect(
          withStorageMutation(database, async () => "released"),
        ).resolves.toBe("released");
      }
      await expect(
        withStorageMutation(database, async () => {
          throw new Error("Storage update failed");
        }),
      ).rejects.toThrow("Storage update failed");
      await expect(
        withMediaMutation(database, [], async () => "released"),
      ).resolves.toBe("released");
    } finally {
      database.close();
    }
  });
});
