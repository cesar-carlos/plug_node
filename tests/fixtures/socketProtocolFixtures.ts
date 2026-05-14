import type {
  AgentCommandRequestBody,
  ConsumerCommandSocketFailurePayload,
  ConsumerCommandSocketSuccessPayload,
  ConsumerCommandStreamChunkPayload,
  ConsumerCommandStreamCompletePayload,
  ConsumerCommandStreamPullResponsePayload,
} from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";

export const socketProtocolRequestId = "request-contract-1";
export const socketProtocolStreamId = "stream-contract-1";

export const agentsCommandRequestFixture = {
  requestId: socketProtocolRequestId,
  clientRequestId: socketProtocolRequestId,
  agentId: "agent-1",
  timeoutMs: 5000,
  payloadFrameCompression: "default",
  command: {
    jsonrpc: "2.0",
    method: "client_token.getPolicy",
    id: socketProtocolRequestId,
    params: {
      client_token: "client-token",
    },
  },
} satisfies AgentCommandRequestBody;

export const agentsCommandResponseFixture = {
  success: true,
  requestId: socketProtocolRequestId,
  clientRequestId: socketProtocolRequestId,
  response: {
    type: "single",
    success: true,
    item: {
      id: socketProtocolRequestId,
      success: true,
      result: {
        policy: "approved",
      },
    },
  },
} satisfies ConsumerCommandSocketSuccessPayload;

export const agentsCommandStreamResponseFixture = {
  success: true,
  requestId: socketProtocolRequestId,
  clientRequestId: socketProtocolRequestId,
  streamId: socketProtocolStreamId,
  response: {
    type: "single",
    success: true,
    item: {
      id: socketProtocolRequestId,
      success: true,
      result: {
        rows: [{ id: 1 }],
        stream_id: socketProtocolStreamId,
      },
    },
  },
} satisfies ConsumerCommandSocketSuccessPayload;

export const agentsCommandFailureFixture = {
  success: false,
  requestId: socketProtocolRequestId,
  error: {
    code: "SERVICE_UNAVAILABLE",
    message: "relay overloaded",
    statusCode: 503,
    retryAfterMs: 2500,
  },
} satisfies ConsumerCommandSocketFailurePayload;

export const agentsCommandStreamChunkFixture = {
  request_id: socketProtocolRequestId,
  stream_id: socketProtocolStreamId,
  rows: [{ id: 2 }],
} satisfies ConsumerCommandStreamChunkPayload;

export const agentsCommandStreamCompleteFixture = {
  request_id: socketProtocolRequestId,
  stream_id: socketProtocolStreamId,
  terminal_status: "completed",
} satisfies ConsumerCommandStreamCompletePayload;

export const agentsStreamPullResponseFixture = {
  success: true,
  requestId: socketProtocolRequestId,
  streamId: socketProtocolStreamId,
  windowSize: 32,
} satisfies ConsumerCommandStreamPullResponsePayload;

export const socketAppErrorFixtures = {
  tokenExpired: {
    code: "TOKEN_EXPIRED",
    message: "token expired",
    statusCode: 401,
  },
  accountBlocked: {
    code: "ACCOUNT_BLOCKED",
    message: "account blocked",
    statusCode: 403,
  },
  agentAccessRevoked: {
    code: "AGENT_ACCESS_REVOKED",
    message: "agent access revoked",
    statusCode: 403,
  },
} as const;
