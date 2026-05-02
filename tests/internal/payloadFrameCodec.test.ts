import { describe, expect, it } from "vitest";

import {
  decodePayloadFrame,
  encodePayloadFrame,
} from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/socket/payloadFrameCodec";

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
});
