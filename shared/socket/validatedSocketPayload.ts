import type {
  DecodedPayloadFrame,
  PayloadFrameSigningOptions,
} from "../contracts/payload-frame";

// Entries exist only for frames validated by a connection dispatcher. Never
// reuse validation under a different signing policy, including rotated keys.
const validated = new WeakMap<
  object,
  {
    readonly context: string;
    readonly decoded: DecodedPayloadFrame;
  }
>();

const frozenContexts = new WeakMap<PayloadFrameSigningOptions, string>();
export const signingContext = (signing?: PayloadFrameSigningOptions): string => {
  if (!signing) return "unsigned";
  const immutable =
    Object.isFrozen(signing) &&
    (!signing.previousKeys ||
      (Object.isFrozen(signing.previousKeys) &&
        signing.previousKeys.every(Object.isFrozen)));
  const cached = immutable ? frozenContexts.get(signing) : undefined;
  if (cached) return cached;
  const context = JSON.stringify({
    key: signing.key,
    keyId: signing.keyId,
    requireSignature: signing.requireSignature === true,
    previousKeys: signing.previousKeys ?? [],
  });
  if (immutable) frozenContexts.set(signing, context);
  return context;
};

export const rememberValidatedSocketPayload = (
  value: object,
  decoded: DecodedPayloadFrame,
  signing?: PayloadFrameSigningOptions,
): void => {
  validated.set(value, { context: signingContext(signing), decoded });
};

export const forgetValidatedSocketPayload = (value: unknown): void => {
  if (typeof value === "object" && value !== null) validated.delete(value);
};

export const getValidatedSocketPayload = <T>(
  value: unknown,
  signing?: PayloadFrameSigningOptions,
): DecodedPayloadFrame<T> | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const entry = validated.get(value);
  return entry?.context === signingContext(signing)
    ? (entry.decoded as DecodedPayloadFrame<T>)
    : undefined;
};
