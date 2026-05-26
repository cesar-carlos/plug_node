export interface PlugErrorOptions {
  readonly code: string;
  readonly statusCode?: number;
  readonly correlationId?: string;
  readonly retryable?: boolean;
  readonly retryAfterSeconds?: number;
  readonly description?: string;
  readonly technicalMessage?: string;
  readonly details?: Record<string, unknown>;
  readonly authRelated?: boolean;
}

export class PlugError extends Error {
  readonly code: string;
  readonly statusCode?: number;
  readonly correlationId?: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;
  readonly description?: string;
  readonly technicalMessage?: string;
  readonly details?: Record<string, unknown>;
  readonly authRelated: boolean;

  constructor(message: string, options: PlugErrorOptions) {
    super(message);
    this.name = "PlugError";
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.correlationId = options.correlationId;
    this.retryable = options.retryable ?? false;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.description = options.description;
    this.technicalMessage = options.technicalMessage;
    this.details = options.details;
    this.authRelated = options.authRelated ?? false;
  }
}

type ExtraErrorOptions = Partial<Omit<PlugErrorOptions, "code">> &
  Record<string, unknown>;

const splitExtraErrorOptions = (
  input: ExtraErrorOptions | undefined,
): {
  readonly known: Partial<Omit<PlugErrorOptions, "code">>;
  readonly details: Record<string, unknown> | undefined;
} => {
  if (!input) {
    return { known: {}, details: undefined };
  }

  const {
    statusCode,
    correlationId,
    retryable,
    retryAfterSeconds,
    description,
    technicalMessage,
    details,
    authRelated,
    ...rest
  } = input;

  const inlineDetails = details && typeof details === "object" ? details : undefined;
  const mergedDetails =
    Object.keys(rest).length > 0 || inlineDetails
      ? { ...(inlineDetails ?? {}), ...rest }
      : undefined;

  return {
    known: {
      ...(statusCode !== undefined ? { statusCode } : {}),
      ...(correlationId !== undefined ? { correlationId } : {}),
      ...(retryable !== undefined ? { retryable } : {}),
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(technicalMessage !== undefined ? { technicalMessage } : {}),
      ...(authRelated !== undefined ? { authRelated } : {}),
    },
    details: mergedDetails as Record<string, unknown> | undefined,
  };
};

export class PlugValidationError extends PlugError {
  constructor(message: string, options?: ExtraErrorOptions) {
    const { known, details } = splitExtraErrorOptions(options);
    super(message, {
      code: "PLUG_VALIDATION_ERROR",
      statusCode: 400,
      ...known,
      ...(details !== undefined ? { details } : {}),
    });
    this.name = "PlugValidationError";
  }
}

export class PlugTimeoutError extends PlugError {
  constructor(message: string, options?: ExtraErrorOptions) {
    const { known, details } = splitExtraErrorOptions(options);
    super(message, {
      code: "PLUG_TIMEOUT",
      statusCode: 408,
      retryable: true,
      ...known,
      ...(details !== undefined ? { details } : {}),
    });
    this.name = "PlugTimeoutError";
  }
}
