import { describe, expect, it } from "vitest";

import {
  decodePayloadFrame,
  decodePayloadFrameAsync,
  encodePayloadFrame,
  encodePayloadFrameAsync,
} from "../../packages/n8n-nodes-plug-database/generated/shared/socket/payloadFrameCodec";
import type { PayloadFrameEnvelope } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/payload-frame";

const createDeterministicRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

const createRandomJsonPayload = (random: () => number, depth = 0): unknown => {
  const pick = Math.floor(random() * (depth > 2 ? 4 : 7));
  if (pick === 0) {
    return null;
  }
  if (pick === 1) {
    return Math.floor(random() * 10_000);
  }
  if (pick === 2) {
    return random() > 0.5;
  }
  if (pick === 3) {
    return `value-${Math.floor(random() * 1_000_000).toString(36)}`;
  }
  if (pick === 4) {
    return Array.from({ length: Math.floor(random() * 5) }, () =>
      createRandomJsonPayload(random, depth + 1),
    );
  }

  return Object.fromEntries(
    Array.from({ length: 1 + Math.floor(random() * 4) }, (_, index) => [
      `field_${depth}_${index}`,
      createRandomJsonPayload(random, depth + 1),
    ]),
  );
};

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

  it("rejects gzip frames whose declared decoded size exceeds 10 MiB before inflation", () => {
    const frame = encodePayloadFrame(
      {
        text: "small payload",
      },
      {
        requestId: "req-declared-too-large",
        compression: "always",
      },
    );
    const tamperedFrame: PayloadFrameEnvelope = {
      ...frame,
      originalSize: 10 * 1024 * 1024 + 1,
    };

    expect(() => decodePayloadFrame(tamperedFrame)).toThrow(
      "PayloadFrame exceeds the 10 MiB decoded limit",
    );
  });

  it("rejects gzip frames whose declared inflation ratio is unsafe before inflation", async () => {
    const frame = await encodePayloadFrameAsync(
      {
        text: "small payload",
      },
      {
        requestId: "req-inflation-ratio",
        compression: "always",
      },
    );
    const tamperedFrame: PayloadFrameEnvelope = {
      ...frame,
      originalSize: frame.compressedSize * 21,
    };

    await expect(decodePayloadFrameAsync(tamperedFrame)).rejects.toThrow(
      "PayloadFrame exceeded the allowed gzip inflation ratio",
    );
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

  it("round-trips deterministic random JSON payloads across compression modes", async () => {
    const random = createDeterministicRandom(0xc0ffee);
    const compressionModes = ["none", "default", "always"] as const;

    for (let index = 0; index < 48; index += 1) {
      const payload = createRandomJsonPayload(random);
      const compression = compressionModes[index % compressionModes.length];
      const frame = encodePayloadFrame(payload, {
        requestId: `fuzz-${index}`,
        compression,
        signing: {
          key: "shared-secret",
        },
      });

      expect(
        decodePayloadFrame(frame, {
          signing: {
            key: "shared-secret",
          },
        }).data,
      ).toEqual(payload);

      await expect(
        decodePayloadFrameAsync(frame, {
          signing: {
            key: "wrong-secret",
          },
        }),
      ).rejects.toThrow("PayloadFrame signature verification failed");
    }
  });

  it("rejects deterministic random metadata tampering before payload trust", () => {
    const random = createDeterministicRandom(0x5afe);

    for (let index = 0; index < 24; index += 1) {
      const frame = encodePayloadFrame(createRandomJsonPayload(random), {
        requestId: `tamper-${index}`,
        compression: index % 2 === 0 ? "none" : "always",
      });
      const tampered =
        index % 3 === 0
          ? { ...frame, compressedSize: frame.compressedSize + 1 }
          : index % 3 === 1
            ? { ...frame, enc: "text" }
            : { ...frame, contentType: "text/plain" };

      expect(() => decodePayloadFrame(tampered)).toThrow();
    }
  });
});
