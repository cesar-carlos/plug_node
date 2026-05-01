export interface PlugErrorOptions {
  readonly code: string;
  readonly statusCode?: number;
  readonly correlationId?: string;
  readonly retryable?: boolean;
  readonly retryAfterSeconds?: number;
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
    this.technicalMessage = options.technicalMessage;
    this.details = options.details;
    this.authRelated = options.authRelated ?? false;
  }
}

export class PlugValidationError extends PlugError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      code: "PLUG_VALIDATION_ERROR",
      statusCode: 400,
      details,
    });
    this.name = "PlugValidationError";
  }
}

export class PlugTimeoutError extends PlugError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      code: "PLUG_TIMEOUT",
      statusCode: 408,
      retryable: true,
      details,
    });
    this.name = "PlugTimeoutError";
  }
}
