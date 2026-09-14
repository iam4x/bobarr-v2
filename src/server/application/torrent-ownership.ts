import type { DownloadRecord, TorrentSnapshot } from "./ports";

import { Buffer } from "node:buffer";
import { posix } from "node:path";

type TorrentOwnership = Pick<
  DownloadRecord,
  "id" | "engineLabel" | "engineInfoHash" | "expectedInfoHash"
>;

export function isOwnedTorrentIdentity(
  record: TorrentOwnership,
  torrent: Pick<TorrentSnapshot, "hash" | "labels">,
  requiredInfoHash?: string,
): boolean {
  const expectedLabel = `bobarr:${record.id}`;
  if (
    record.engineLabel !== expectedLabel ||
    !torrent.labels.includes(expectedLabel)
  ) {
    return false;
  }

  const actualInfoHash = canonicalInfoHash(torrent.hash);
  if (actualInfoHash === null) return false;
  for (const hash of [
    record.engineInfoHash,
    record.expectedInfoHash,
    requiredInfoHash,
  ]) {
    if (hash === null || hash === undefined) continue;
    const canonical = canonicalInfoHash(hash);
    if (canonical === null || canonical !== actualInfoHash) return false;
  }
  return true;
}

export function isOwnedTorrent(
  record: TorrentOwnership & Pick<DownloadRecord, "downloadDirectory">,
  torrent: Pick<TorrentSnapshot, "hash" | "labels" | "downloadDirectory">,
  requiredInfoHash?: string,
): boolean {
  const recordDirectory = posix.normalize(record.downloadDirectory);
  return (
    posix.basename(recordDirectory) === record.id &&
    posix.normalize(torrent.downloadDirectory) === recordDirectory &&
    isOwnedTorrentIdentity(record, torrent, requiredInfoHash)
  );
}

function canonicalInfoHash(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^[a-f\d]{40}$/i.test(value)) return value.toLowerCase();
  if (/^[a-z2-7]{32}$/i.test(value)) return decodeBase32Hash(value);
  if (/^1220[a-f\d]{64}$/i.test(value)) return value.slice(4).toLowerCase();
  if (/^[a-f\d]{64}$/i.test(value)) return value.toLowerCase();
  return null;
}

function decodeBase32Hash(value: string): string | null {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes: number[] = [];
  let buffer = 0;
  let bitCount = 0;
  for (const character of value.toUpperCase()) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return null;
    buffer = (buffer << 5) | digit;
    bitCount += 5;
    while (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((buffer >> bitCount) & 0xff);
      buffer &= (1 << bitCount) - 1;
    }
  }
  return bytes.length === 20 ? Buffer.from(bytes).toString("hex") : null;
}
