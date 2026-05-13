import { describe, expect, it } from "vitest";

import {
  decodePayloadFrame,
  decodePayloadFrameAsync,
  encodePayloadFrame,
  encodePayloadFrameAsync,
} from "../../packages/n8n-nodes-plug-database/generated/shared/socket/payloadFrameCodec";

describe("payloadFrameCodec", () => {
  it("encodes and decodes JSON payloads", () => {
    const frame = encodePayloadFrame(
      {
        jsonrpc: "2.0",
        id: "req-1",
        result: {
          rows: [{ id: 1 }],
        },
      },
      { requestId: "req-1" },
    );

    const decoded = decodePayloadFrame(frame);

    expect(decoded.frame.requestId).toBe("req-1");
    expect(decoded.data).toMatchObject({
      jsonrpc: "2.0",
      id: "req-1",
    });
  });

  it("uses gzip when the payload is large and compressible", () => {
    const frame = encodePayloadFrame(
      {
        jsonrpc: "2.0",
        id: "req-2",
        result: {
          text: Array.from({ length: 400 }, (_, index) => `plug-row-${index}-value`)
            .join("|")
            .repeat(2),
        },
      },
      { requestId: "req-2" },
    );

    expect(frame.cmp).toBe("gzip");
    expect(decodePayloadFrame(frame).data).toMatchObject({
      id: "req-2",
    });
  });

  it("does not gzip when compression savings are below the minimum threshold", () => {
    const frame = encodePayloadFrame(
      {
        text: "x".repeat(1024) + Math.random().toString(36).repeat(16),
      },
      {
        requestId: "req-small-savings",
      },
    );

    if (frame.cmp === "gzip") {
      expect(frame.originalSize - frame.compressedSize).toBeGreaterThanOrEqual(64);
    } else {
      expect(frame.cmp).toBe("none");
    }
  });

  it("can omit traceId on high-volume frames", () => {
    const frame = encodePayloadFrame(
      {
        stream_id: "stream-1",
        request_id: "request-1",
        window_size: 32,
      },
      {
        requestId: "request-1",
        omitTraceId: true,
      },
    );

    expect(frame.traceId).toBeUndefined();
  });

  it("signs and verifies PayloadFrame envelopes with HMAC-SHA256", () => {
    const frame = encodePayloadFrame(
      {
        jsonrpc: "2.0",
        id: "req-signed",
        result: { ok: true },
      },
      {
        requestId: "req-signed",
        compression: "none",
        signing: {
          key: "shared-secret",
          keyId: "hub-2026-q2",
        },
      },
    );

    expect(frame.signature).toMatchObject({
      alg: "hmac-sha256",
      key_id: "hub-2026-q2",
    });
    expect(
      decodePayloadFrame(frame, {
        signing: {
          key: "shared-secret",
          keyId: "hub-2026-q2",
        },
      }).data,
    ).toMatchObject({
      id: "req-signed",
    });
  });

  it("rejects signed frames when the local verification key is missing or wrong", () => {
    const frame = encodePayloadFrame(
      {
        jsonrpc: "2.0",
        id: "req-signed",
        result: { ok: true },
      },
      {
        requestId: "req-signed",
        compression: "none",
        signing: {
          key: "shared-secret",
          keyId: "hub-2026-q2",
        },
      },
    );

    expect(() => decodePayloadFrame(frame)).toThrow(
      "PayloadFrame signature is present but no signing key is configured",
    );
    expect(() =>
      decodePayloadFrame(frame, {
        signing: {
          key: "wrong-secret",
          keyId: "hub-2026-q2",
        },
      }),
    ).toThrow("PayloadFrame signature verification failed");
    expect(() =>
      decodePayloadFrame(frame, {
        signing: {
          key: "shared-secret",
          keyId: "other-key",
        },
      }),
    ).toThrow("PayloadFrame signature key_id mismatch");
  });

  it("rejects PayloadFrame envelopes with unsupported fields", () => {
    const frame = encodePayloadFrame({ ok: true }, { requestId: "req-strict" });

    expect(() =>
      decodePayloadFrame({
        ...frame,
        unexpected: true,
      }),
    ).toThrow("PayloadFrame contains unsupported fields");
    expect(() =>
      decodePayloadFrame({
        ...frame,
        signature: {
          alg: "hmac-sha256",
          value: "abc",
          extra: true,
        },
      }),
    ).toThrow("PayloadFrame signature contains unsupported fields");
  });

  it("async encode/decode preserves the same logical payload", async () => {
    const data = {
      jsonrpc: "2.0",
      id: "req-async",
      result: {
        rows: Array.from({ length: 8_000 }, (_, index) => ({
          id: index,
          value: `plug-row-${index.toString(36).padStart(6, "0")}-${(
            (index * 2_654_435_761) >>>
            0
          ).toString(36)}`,
        })),
      },
    };

    const frame = await encodePayloadFrameAsync(data, {
      requestId: "req-async",
      signing: {
        key: "shared-secret",
        keyId: "hub-2026-q2",
      },
    });
    const decoded = await decodePayloadFrameAsync(frame, {
      signing: {
        key: "shared-secret",
        keyId: "hub-2026-q2",
      },
    });

    expect(frame.cmp).toBe("gzip");
    expect(decoded.data).toEqual(data);
  });

  it("async decode verifies HMAC before attempting to decompress", async () => {
    const frame = await encodePayloadFrameAsync(
      {
        jsonrpc: "2.0",
        id: "req-async-signed",
        result: {
          text: "compress-me|".repeat(12_000),
        },
      },
      {
        requestId: "req-async-signed",
        signing: {
          key: "shared-secret",
        },
      },
    );

    expect(frame.cmp).toBe("gzip");
    await expect(
      decodePayloadFrameAsync(frame, {
        signing: {
          key: "wrong-secret",
        },
      }),
    ).rejects.toThrow("PayloadFrame signature verification failed");
  });

  it("async decode rejects invalid signatures, key mismatches, and unsupported fields", async () => {
    const frame = await encodePayloadFrameAsync(
      { ok: true },
      {
        requestId: "req-async-strict",
        compression: "none",
        signing: {
          key: "shared-secret",
          keyId: "hub-2026-q2",
        },
      },
    );

    await expect(decodePayloadFrameAsync(frame)).rejects.toThrow(
      "PayloadFrame signature is present but no signing key is configured",
    );
    await expect(
      decodePayloadFrameAsync(frame, {
        signing: {
          key: "shared-secret",
          keyId: "other-key",
        },
      }),
    ).rejects.toThrow("PayloadFrame signature key_id mismatch");
    await expect(
      decodePayloadFrameAsync({
        ...frame,
        unexpected: true,
      }),
    ).rejects.toThrow("PayloadFrame contains unsupported fields");
  });
});
