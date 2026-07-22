import type { SecretMetadata } from "../../contracts";
import type { Clock } from "../core";
import type { SecretRepository } from "../db";

import { AppError, systemClock } from "../core";

const KEY_VERSION = 1;
const NONCE_BYTES = 12;

export class SecretVault {
  private constructor(
    private readonly key: CryptoKey,
    private readonly repository: SecretRepository,
    private readonly clock: Clock,
  ) {}

  static async create(
    encodedKey: string,
    repository: SecretRepository,
    clock: Clock = systemClock,
  ): Promise<SecretVault> {
    const keyBytes = Uint8Array.fromBase64(encodedKey, {
      alphabet: "base64url",
    });
    if (keyBytes.byteLength !== 32) {
      throw new AppError({
        code: "internal_error",
        message: "The encryption key must contain exactly 32 bytes",
        status: 500,
      });
    }
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
    return new SecretVault(key, repository, clock);
  }

  list(): SecretMetadata[] {
    return this.repository.list();
  }

  async set(name: string, plaintext: string): Promise<SecretMetadata> {
    const nonce = new Uint8Array(NONCE_BYTES);
    crypto.getRandomValues(nonce);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: this.additionalData(name) },
      this.key,
      new TextEncoder().encode(plaintext),
    );
    return this.repository.upsert({
      name,
      ciphertext: new Uint8Array(ciphertext).toBase64({
        alphabet: "base64url",
        omitPadding: true,
      }),
      nonce: nonce.toBase64({ alphabet: "base64url", omitPadding: true }),
      keyVersion: KEY_VERSION,
      updatedAt: this.clock.now().getTime(),
    });
  }

  async get(name: string): Promise<string | undefined> {
    const record = this.repository.get(name);
    if (record === undefined) return undefined;
    if (record.keyVersion !== KEY_VERSION) {
      throw new AppError({
        code: "internal_error",
        message: `Secret ${name} uses an unsupported encryption version`,
        status: 500,
      });
    }

    try {
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: new Uint8Array(
            Uint8Array.fromBase64(record.nonce, { alphabet: "base64url" }),
          ),
          additionalData: this.additionalData(name),
        },
        this.key,
        Uint8Array.fromBase64(record.ciphertext, { alphabet: "base64url" }),
      );
      return new TextDecoder().decode(plaintext);
    } catch (error) {
      throw new AppError({
        code: "internal_error",
        message: `Secret ${name} could not be decrypted`,
        status: 500,
        cause: error,
      });
    }
  }

  delete(name: string): boolean {
    return this.repository.delete(name);
  }

  private additionalData(name: string): Uint8Array<ArrayBuffer> {
    return new TextEncoder().encode(`bobarr:secret:v${KEY_VERSION}:${name}`);
  }
}
