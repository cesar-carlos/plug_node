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
  const base64 = textOrThrow(value, "Base64").replace(/\s+/gu, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(base64) || base64.length % 4 !== 0) {
    throw new PlugValidationError("Base64 must be a valid base64 string");
  }

  return Buffer.from(base64, "base64");
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

const deriveKey = (passphrase: string, salt: Buffer): Buffer =>
  pbkdf2Sync(passphrase, salt, 120_000, 32, "sha256");

export const encryptText = (
  plaintext: unknown,
  passphraseValue: unknown,
): {
  readonly ciphertext: string;
  readonly iv: string;
  readonly salt: string;
  readonly tag: string;
  readonly algorithm: "aes-256-gcm";
} => {
  const passphrase = textOrThrow(passphraseValue, "Passphrase");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
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
  };
};

export const decryptText = (
  input: {
    readonly ciphertext: unknown;
    readonly iv: unknown;
    readonly salt: unknown;
    readonly tag: unknown;
  },
  passphraseValue: unknown,
): string => {
  const passphrase = textOrThrow(passphraseValue, "Passphrase");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(passphrase, Buffer.from(textOrThrow(input.salt, "Salt"), "base64")),
    Buffer.from(textOrThrow(input.iv, "IV"), "base64"),
  );
  decipher.setAuthTag(Buffer.from(textOrThrow(input.tag, "Tag"), "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(textOrThrow(input.ciphertext, "Ciphertext"), "base64")),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
};
type DigestEncoding = "base64" | "base64url" | "hex";
