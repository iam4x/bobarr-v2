export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

export const bunPasswordHasher: PasswordHasher = {
  hash: (password) =>
    Bun.password.hash(password, {
      algorithm: "argon2id",
      memoryCost: 65_536,
      timeCost: 3,
    }),
  verify: (password, hash) => Bun.password.verify(password, hash, "argon2id"),
};

/** Deterministic no-cost hasher for `environment: "test"` fixtures. */
export const testPasswordHasher: PasswordHasher = {
  async hash(password) {
    return `test-hash:${password}`;
  },
  async verify(password, hash) {
    return hash === `test-hash:${password}`;
  },
};
