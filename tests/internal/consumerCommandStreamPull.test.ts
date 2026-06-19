import { describe, expect, it } from "vitest";

import { matchesConsumerStreamPullResponse } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/consumerCommandStreamPull";

describe("matchesConsumerStreamPullResponse", () => {
  it("requires requestId and streamId on successful pull responses", () => {
    expect(
      matchesConsumerStreamPullResponse(
        {
          success: true,
          requestId: "req-1",
          streamId: "stream-1",
          windowSize: 8,
        },
        "req-1",
        "stream-1",
      ),
    ).toBe(true);

    expect(
      matchesConsumerStreamPullResponse(
        {
          success: true,
          requestId: "other",
          streamId: "stream-1",
          windowSize: 8,
        },
        "req-1",
        "stream-1",
      ),
    ).toBe(false);
  });

  it("accepts uncorrelated failure payloads for fail-fast handling on the active pull", () => {
    expect(
      matchesConsumerStreamPullResponse(
        {
          success: false,
          error: {
            code: "STREAM_LOST",
            message: "Stream was lost",
          },
        },
        "req-1",
        "stream-1",
      ),
    ).toBe(true);
  });
});
