import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
const require = createRequire(import.meta.url);
const {
  isValidActionIoResponse,
} = require("../packages/n8n-nodes-plug-database/dist/generated/shared/contracts/actionIo/results.js");
const {
  encodePayloadFrame,
  decodePayloadFrame,
} = require("../packages/n8n-nodes-plug-database/dist/generated/shared/socket/payloadFrameCodec.js");
const block = Buffer.alloc(65536, 255).toString("base64");
const response = {
  jsonrpc: "2.0",
  id: "bench",
  result: {
    execution_id: "e",
    events: Array.from({ length: 4 }, (_, i) => ({
      type: "output",
      sequence: i + 1,
      stream: "stdout",
      offset: i * 65536,
      data_base64: block,
    })),
    next_sequence: 4,
    terminal: false,
    output_complete: false,
  },
};
const frame = encodePayloadFrame(response, { compression: "none" });
const durations = [];
for (let i = 0; i < 210; i++) {
  const start = performance.now();
  const data = decodePayloadFrame(frame).data;
  if (
    !isValidActionIoResponse("agent.action.readIo", data, {
      executionId: "e",
      afterSequence: 0,
      maxBytes: 262144,
    })
  )
    throw new Error("Invalid benchmark fixture");
  if (i >= 10) durations.push(performance.now() - start);
}
durations.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      node: process.version,
      iterations: durations.length,
      pageContentBytes: 262144,
      frameBytes: frame.originalSize,
      medianMs: durations[100],
      p95Ms: durations[189],
      rssBytes: process.memoryUsage().rss,
      scope:
        "local uncompressed decode + method/offset validation; no network, database, browser or native process timing",
    },
    null,
    2,
  ),
);
