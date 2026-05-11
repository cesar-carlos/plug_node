export interface PayloadFrameSignature {
  readonly alg: "hmac-sha256";
  readonly value: string;
  readonly key_id?: string;
}

export interface PayloadFrameEnvelope {
  readonly schemaVersion: "1.0";
  readonly enc: "json";
  readonly cmp: "none" | "gzip";
  readonly contentType: "application/json";
  readonly originalSize: number;
  readonly compressedSize: number;
  readonly payload: Uint8Array | number[] | string;
  readonly traceId?: string;
  readonly requestId?: string | null;
  readonly signature?: PayloadFrameSignature;
}

export interface DecodedPayloadFrame<TData = unknown> {
  readonly frame: PayloadFrameEnvelope;
  readonly bytes: Buffer;
  readonly data: TData;
}

export interface PayloadFrameSigningOptions {
  readonly key?: string;
  readonly keyId?: string;
}
