import type { PlugCredentialDefaults } from "../contracts/api";
import type {
  PayloadFrameSigningKeyEntry,
  PayloadFrameSigningOptions,
} from "../contracts/payload-frame";
import { PlugValidationError } from "../contracts/errors";
import { isRecord } from "../utils/json";
import { toOptionalString } from "./plugExecutionParameters";

const parsePreviousSigningKeys = (
  raw: string | undefined,
): readonly PayloadFrameSigningKeyEntry[] => {
  if (!raw || raw.trim() === "") {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PlugValidationError(
      "Payload Signing Previous Keys JSON must be a valid JSON array.",
    );
  }

  if (!Array.isArray(parsed)) {
    if (isRecord(parsed)) {
      const entries: PayloadFrameSigningKeyEntry[] = [];
      for (const [keyId, keyValue] of Object.entries(parsed)) {
        const key = toOptionalString(keyValue);
        if (!key) {
          throw new PlugValidationError(
            "Payload Signing Previous Keys JSON object values must be non-empty key strings.",
          );
        }

        entries.push({
          key,
          ...(keyId.trim() !== "" ? { keyId } : {}),
        });
      }

      return entries;
    }

    throw new PlugValidationError(
      "Payload Signing Previous Keys JSON must be an array of { key, keyId? } objects or a { keyId: key } object.",
    );
  }

  const entries: PayloadFrameSigningKeyEntry[] = [];
  for (const item of parsed) {
    if (!isRecord(item)) {
      throw new PlugValidationError(
        "Payload Signing Previous Keys JSON entries must be objects with a key field.",
      );
    }

    const key = toOptionalString(item.key);
    if (!key) {
      throw new PlugValidationError(
        "Payload Signing Previous Keys JSON entries must include a non-empty key.",
      );
    }

    entries.push({
      key,
      ...(toOptionalString(item.keyId) ? { keyId: toOptionalString(item.keyId) } : {}),
    });
  }

  return entries;
};

export const resolvePayloadFrameSigning = (
  credentials: PlugCredentialDefaults,
  options?: {
    readonly requireSignature?: boolean;
  },
): PayloadFrameSigningOptions | undefined => {
  const key = toOptionalString(credentials.payloadSigningKey);
  const keyId = toOptionalString(credentials.payloadSigningKeyId);
  const previousKeys = parsePreviousSigningKeys(
    toOptionalString(credentials.payloadSigningPreviousKeysJson),
  );

  if (!key && !keyId && previousKeys.length === 0 && options?.requireSignature !== true) {
    return undefined;
  }

  return {
    ...(key ? { key } : {}),
    ...(keyId ? { keyId } : {}),
    ...(previousKeys.length > 0 ? { previousKeys } : {}),
    ...(options?.requireSignature === true ? { requireSignature: true } : {}),
  };
};
