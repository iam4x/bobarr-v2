import { describe, expect, test } from "bun:test";

import { isOwnedTorrent, isOwnedTorrentIdentity } from "./torrent-ownership";

const DOWNLOAD_ID = "70000000-0000-4000-8000-000000000001";
const V1_HASH = "000102030405060708090a0b0c0d0e0f10111213";
const BASE32_HASH = "AAAQEAYEAUDAOCAJBIFQYDIOB4IBCEQT";
const V2_HASH = "0123456789abcdef".repeat(4);
const OTHER_HASH = "f".repeat(40);

describe("torrent ownership", () => {
  test.each([
    ["v1 hexadecimal", V1_HASH.toUpperCase(), V1_HASH],
    ["v1 base32", BASE32_HASH, V1_HASH],
    ["lowercase v1 base32", BASE32_HASH.toLowerCase(), V1_HASH],
    ["v2 multihash", `1220${V2_HASH}`, V2_HASH.toUpperCase()],
    ["v2 hexadecimal", V2_HASH.toUpperCase(), V2_HASH],
  ])("accepts equivalent %s encodings", (_name, recordedHash, returnedHash) => {
    const record = download(recordedHash);
    const torrent = snapshot(returnedHash);
    expect(isOwnedTorrentIdentity(record, torrent)).toBe(true);
    expect(isOwnedTorrent(record, torrent)).toBe(true);
  });

  test("rejects a different returned hash despite matching label and directory", () => {
    const record = download(V1_HASH);
    const torrent = snapshot(OTHER_HASH);
    expect(isOwnedTorrentIdentity(record, torrent)).toBe(false);
    expect(isOwnedTorrent(record, torrent)).toBe(false);
  });

  test("every recorded or required hash must match the returned hash", () => {
    const record = {
      ...download(V1_HASH),
      expectedInfoHash: BASE32_HASH,
    };
    const torrent = snapshot(V1_HASH);
    expect(isOwnedTorrentIdentity(record, torrent, V1_HASH.toUpperCase())).toBe(
      true,
    );
    expect(isOwnedTorrentIdentity(record, torrent, OTHER_HASH)).toBe(false);
    expect(
      isOwnedTorrentIdentity(
        { ...record, expectedInfoHash: OTHER_HASH },
        torrent,
      ),
    ).toBe(false);
    expect(
      isOwnedTorrentIdentity(
        { ...record, engineInfoHash: OTHER_HASH },
        torrent,
      ),
    ).toBe(false);
  });

  test("requires the ownership label to match the download ID in both records", () => {
    const record = download(V1_HASH);
    const torrent = snapshot(V1_HASH);
    const otherLabel = "bobarr:70000000-0000-4000-8000-000000000002";
    expect(
      isOwnedTorrentIdentity(record, { ...torrent, labels: [otherLabel] }),
    ).toBe(false);
    expect(
      isOwnedTorrentIdentity(
        { ...record, engineLabel: otherLabel },
        { ...torrent, labels: [otherLabel] },
      ),
    ).toBe(false);
  });

  test("rejects malformed recorded or returned hashes", () => {
    expect(isOwnedTorrentIdentity(download("invalid"), snapshot(V1_HASH))).toBe(
      false,
    );
    expect(isOwnedTorrentIdentity(download(V1_HASH), snapshot("invalid"))).toBe(
      false,
    );
  });

  test("acquisition requires the exact normalized download directory and UUID basename", () => {
    const record = download(V1_HASH);
    const torrent = snapshot(V1_HASH);
    expect(
      isOwnedTorrent(record, {
        ...torrent,
        downloadDirectory: `/downloads/intermediate/../${DOWNLOAD_ID}`,
      }),
    ).toBe(true);
    const relocated = {
      ...torrent,
      downloadDirectory: `/other-downloads/${DOWNLOAD_ID}`,
    };
    expect(isOwnedTorrentIdentity(record, relocated)).toBe(true);
    expect(isOwnedTorrent(record, relocated)).toBe(false);
    expect(
      isOwnedTorrent(
        { ...record, downloadDirectory: "/downloads/shared" },
        { ...torrent, downloadDirectory: "/downloads/shared" },
      ),
    ).toBe(false);
  });
});

function download(
  engineInfoHash: string,
): Parameters<typeof isOwnedTorrent>[0] {
  return {
    id: DOWNLOAD_ID,
    engineInfoHash,
    expectedInfoHash: null,
    engineLabel: `bobarr:${DOWNLOAD_ID}`,
    downloadDirectory: `/downloads/${DOWNLOAD_ID}`,
  };
}

function snapshot(hash: string): Parameters<typeof isOwnedTorrent>[1] {
  return {
    hash,
    labels: [`bobarr:${DOWNLOAD_ID}`],
    downloadDirectory: `/downloads/${DOWNLOAD_ID}`,
  };
}
