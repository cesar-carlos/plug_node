import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
} from "node:crypto";

import { decodeJwt, decodeProtectedHeader } from "jose";

import { PlugValidationError } from "../contracts/errors";

type DigestEncoding = "base64" | "base64url" | "hex";

// Default PBKDF2-SHA256 iterations. OWASP 2023+ recommends >= 600k for SHA-256.
// Values encrypted before the upgrade carry their original iteration count in
// the envelope so decryptText can still recover them.
export const KDF_ITERATIONS = 600_000;
const LEGACY_KDF_ITERATIONS = 120_000;
const KDF_KEY_BYTES = 32;
const KDF_DIGEST = "sha256";

const textOrThrow = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new PlugValidationError(`${label} must be a non-empty string`);
  }

  return value;
};

export const generateHash = (
  value: string | Buffer,
  algorithm: string,
  encoding: DigestEncoding = "hex",
): string => createHash(algorithm).update(value).digest(encoding);

export const hmacSign = (
  value: string | Buffer,
  secret: unknown,
  algorithm: string,
  encoding: DigestEncoding = "hex",
): string =>
  createHmac(algorithm, textOrThrow(secret, "Secret")).update(value).digest(encoding);

export const base64Encode = (value: string | Buffer): string =>
  Buffer.from(value).toString("base64");

export const base64DecodeToBuffer = (value: unknown): Buffer => {
  const raw = textOrThrow(value, "Base64").replace(/\s+/gu, "");
  const isStandard = /^[A-Za-z0-9+/]*={0,2}$/u.test(raw);
  const isUrlSafe = /^[A-Za-z0-9_-]*={0,2}$/u.test(raw);

  if (!isStandard && !isUrlSafe) {
    throw new PlugValidationError("Base64 must be a valid base64 or base64url string");
  }

  if (isUrlSafe && !isStandard) {
    // base64url tolerates unpadded input; Node's "base64url" decoder handles both.
    return Buffer.from(raw, "base64url");
  }

  if (raw.length % 4 !== 0) {
    throw new PlugValidationError("Base64 must be padded to a multiple of 4 characters");
  }

  return Buffer.from(raw, "base64");
};

export const base64DecodeToText = (value: unknown): string =>
  base64DecodeToBuffer(value).toString("utf8");

export const decodeJwtUnsafe = (
  token: unknown,
): { header: unknown; payload: unknown } => {
  const jwt = textOrThrow(token, "JWT");
  return {
    header: decodeProtectedHeader(jwt),
    payload: decodeJwt(jwt),
  };
};

const deriveKey = (passphrase: string, salt: Buffer, iterations: number): Buffer =>
  pbkdf2Sync(passphrase, salt, iterations, KDF_KEY_BYTES, KDF_DIGEST);

export interface EncryptTextResult {
  readonly ciphertext: string;
  readonly iv: string;
  readonly salt: string;
  readonly tag: string;
  readonly algorithm: "aes-256-gcm";
  readonly iterations: number;
}

export const encryptText = (
  plaintext: unknown,
  passphraseValue: unknown,
): EncryptTextResult => {
  const passphrase = textOrThrow(passphraseValue, "Passphrase");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveKey(passphrase, salt, KDF_ITERATIONS),
    iv,
  );
  const ciphertext = Buffer.concat([
    cipher.update(textOrThrow(plaintext, "Plaintext"), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    salt: salt.toString("base64"),
    tag: tag.toString("base64"),
    algorithm: "aes-256-gcm",
    iterations: KDF_ITERATIONS,
  };
};

const normalizeIterations = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    // Inputs encrypted before the iteration field existed default to the
    // legacy 120k count so they remain decryptable.
    return LEGACY_KDF_ITERATIONS;
  }

  return value;
};

export const decryptText = (
  input: {
    readonly ciphertext: unknown;
    readonly iv: unknown;
    readonly salt: unknown;
    readonly tag: unknown;
    readonly iterations?: unknown;
  },
  passphraseValue: unknown,
): string => {
  const passphrase = textOrThrow(passphraseValue, "Passphrase");
  const iterations = normalizeIterations(input.iterations);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(
      passphrase,
      Buffer.from(textOrThrow(input.salt, "Salt"), "base64"),
      iterations,
    ),
    Buffer.from(textOrThrow(input.iv, "IV"), "base64"),
  );
  decipher.setAuthTag(Buffer.from(textOrThrow(input.tag, "Tag"), "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(textOrThrow(input.ciphertext, "Ciphertext"), "base64")),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
};
