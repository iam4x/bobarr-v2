import type {
  CandidateCipher,
  CandidateSource,
  ProtectedCandidatePayload,
} from "./ports";

import { Buffer } from "node:buffer";

const VERSION = "v1";
const ADDITIONAL_DATA = new TextEncoder().encode("bobarr:candidate-source:v1");

export interface AesCandidateCipherOptions {
  key: Uint8Array;
  randomBytes?: (length: number) => Uint8Array;
}

export class CandidateCipherError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "CandidateCipherError";
  }
}

export function createAesCandidateCipher(
  options: AesCandidateCipherOptions,
): CandidateCipher {
  if (options.key.byteLength !== 32) {
    throw new TypeError(
      "Candidate encryption key must contain exactly 32 bytes",
    );
  }
  const keyBytes = Uint8Array.from(options.key);
  const key = crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  const randomBytes =
    options.randomBytes ??
    ((length: number): Uint8Array =>
      crypto.getRandomValues(new Uint8Array(length)));

  return {
    async seal(payload) {
      validateProtectedPayload(payload);
      const iv = ownedBytes(randomBytes(12));
      if (iv.byteLength !== 12) {
        throw new CandidateCipherError(
          "Candidate cipher returned an invalid IV",
        );
      }
      const plaintext = new TextEncoder().encode(JSON.stringify(payload));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: ADDITIONAL_DATA },
        await key,
        plaintext,
      );
      return `${VERSION}.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
    },

    async open(token) {
      const parts = token.split(".");
      if (
        parts.length !== 3 ||
        parts[0] !== VERSION ||
        !parts[1] ||
        !parts[2]
      ) {
        throw new CandidateCipherError("Candidate ciphertext is malformed");
      }
      try {
        const plaintext = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: fromBase64Url(parts[1]),
            additionalData: ADDITIONAL_DATA,
          },
          await key,
          fromBase64Url(parts[2]),
        );
        const payload = JSON.parse(
          new TextDecoder().decode(plaintext),
        ) as unknown;
        validateProtectedPayload(payload);
        return payload;
      } catch (error) {
        if (error instanceof CandidateCipherError) throw error;
        throw new CandidateCipherError(
          "Candidate ciphertext could not be authenticated",
          error,
        );
      }
    },
  };
}

function validateProtectedPayload(
  value: unknown,
): asserts value is ProtectedCandidatePayload {
  if (
    typeof value !== "object" ||
    value === null ||
    !("source" in value) ||
    !("target" in value) ||
    typeof value.target !== "object" ||
    value.target === null ||
    !("kind" in value.target) ||
    !("title" in value.target) ||
    typeof value.target.kind !== "string" ||
    typeof value.target.title !== "string" ||
    !("infoHash" in value) ||
    (value.infoHash !== null && typeof value.infoHash !== "string")
  ) {
    throw new CandidateCipherError("Protected candidate payload is invalid");
  }
  validateCandidateSource(value.source);
}

function validateCandidateSource(
  value: unknown,
): asserts value is CandidateSource {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    throw new CandidateCipherError("Candidate source is invalid");
  }
  if (value.kind === "magnet") {
    if (!("magnetUri" in value) || typeof value.magnetUri !== "string") {
      throw new CandidateCipherError("Candidate magnet source is invalid");
    }
    return;
  }
  if (value.kind === "jackett") {
    if (!("downloadUrl" in value) || typeof value.downloadUrl !== "string") {
      throw new CandidateCipherError("Candidate Jackett source is invalid");
    }
    const url = new URL(value.downloadUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new CandidateCipherError("Candidate Jackett URL is invalid");
    }
    return;
  }
  if (value.kind === "metainfo") {
    if (
      !("metainfoBase64" in value) ||
      typeof value.metainfoBase64 !== "string" ||
      !/^[a-z\d+/]+={0,2}$/i.test(value.metainfoBase64)
    ) {
      throw new CandidateCipherError("Candidate metainfo source is invalid");
    }
    return;
  }
  throw new CandidateCipherError("Candidate source kind is unsupported");
}

function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  return ownedBytes(Buffer.from(value, "base64url"));
}

function ownedBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}
