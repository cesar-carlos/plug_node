import type { PayloadFrameEnvelope } from "./payload-frame";

export const DEFAULT_BASE_URL = "https://plug-server.se7esistemassinop.com.br/api/v1";
export const DEFAULT_API_VERSION = "2.8";
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_RELAY_PULL_WINDOW = 32;

export type PlugChannel = "rest" | "socket";
export type PlugResponseMode = "aggregatedJson" | "chunkItems" | "rawJsonRpc";
export type PlugInputMode = "guided" | "advanced";
export type PlugOperation =
  | "validateContext"
  | "executeSql"
  | "executeBatch"
  | "cancelSql"
  | "discoverRpc"
  | "getAgentProfile"
  | "getClientTokenPolicy";

export type PlugCommandMethod =
  | "sql.execute"
  | "sql.executeBatch"
  | "sql.cancel"
  | "rpc.discover"
  | "agent.getProfile"
  | "client_token.getPolicy";

export type PayloadFrameCompression = "default" | "none" | "always";
export type JsonRpcId = string | number | null;
export type JsonObject = Record<string, unknown>;
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export interface PlugCredentials {
  readonly user: string;
  readonly password: string;
  readonly agentId: string;
  readonly clientToken: string;
  readonly baseUrl: string;
}

export interface PlugClientProfile {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly lastName: string;
  readonly mobile?: string;
  readonly thumbnailUrl?: string;
  readonly status: string;
  readonly role: "client";
  readonly [key: string]: unknown;
}

export interface PlugLoginResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly client: PlugClientProfile;
  readonly success?: boolean;
  readonly token?: string;
}

export interface PlugSession {
  readonly credentials: PlugCredentials;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly loginResponse: PlugLoginResponse;
}

export interface PlugHttpRequestOptions {
  readonly method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly timeoutMs?: number;
}

export interface PlugHttpResponse<TBody = unknown> {
  readonly statusCode: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: TBody;
}

export type PlugHttpRequester = <TBody = unknown>(
  options: PlugHttpRequestOptions,
) => Promise<PlugHttpResponse<TBody>>;

export interface RpcMeta extends JsonObject {
  readonly traceparent?: string;
  readonly tracestate?: string;
}

export interface RpcCommandBase {
  readonly jsonrpc?: "2.0";
  readonly method: PlugCommandMethod;
  readonly id?: JsonRpcId;
  readonly api_version?: string;
  readonly meta?: RpcMeta;
}

export interface SqlExecuteOptions extends JsonObject {
  readonly timeout_ms?: number;
  readonly max_rows?: number;
  readonly page?: number;
  readonly page_size?: number;
  readonly cursor?: string;
  readonly execution_mode?: "managed" | "preserve";
  readonly preserve_sql?: boolean;
  readonly multi_result?: boolean;
}

export interface SqlExecuteParams extends JsonObject {
  readonly sql: string;
  readonly params?: JsonObject;
  readonly client_token?: string;
  readonly clientToken?: string;
  readonly auth?: string;
  readonly idempotency_key?: string;
  readonly database?: string;
  readonly options?: SqlExecuteOptions;
}

export interface SqlExecuteCommand extends RpcCommandBase {
  readonly method: "sql.execute";
  readonly params: SqlExecuteParams;
}

export interface SqlExecuteBatchCommandItem extends JsonObject {
  readonly sql: string;
  readonly params?: JsonObject;
  readonly execution_order?: number;
}

export interface SqlExecuteBatchParams extends JsonObject {
  readonly commands: SqlExecuteBatchCommandItem[];
  readonly client_token?: string;
  readonly clientToken?: string;
  readonly auth?: string;
  readonly idempotency_key?: string;
  readonly database?: string;
  readonly options?: {
    readonly timeout_ms?: number;
    readonly max_rows?: number;
    readonly transaction?: boolean;
  };
}

export interface SqlExecuteBatchCommand extends RpcCommandBase {
  readonly method: "sql.executeBatch";
  readonly params: SqlExecuteBatchParams;
}

export interface SqlCancelCommand extends RpcCommandBase {
  readonly method: "sql.cancel";
  readonly params: {
    readonly execution_id?: string;
    readonly request_id?: string;
  };
}

export interface RpcDiscoverCommand extends RpcCommandBase {
  readonly method: "rpc.discover";
  readonly params?: JsonObject;
}

export interface ClientTokenCarrierParams extends JsonObject {
  readonly client_token?: string;
  readonly clientToken?: string;
  readonly auth?: string;
}

export interface AgentGetProfileCommand extends RpcCommandBase {
  readonly method: "agent.getProfile";
  readonly params?: ClientTokenCarrierParams;
}

export interface ClientTokenGetPolicyCommand extends RpcCommandBase {
  readonly method: "client_token.getPolicy";
  readonly params?: ClientTokenCarrierParams;
}

export type RpcSingleCommand =
  | SqlExecuteCommand
  | SqlExecuteBatchCommand
  | SqlCancelCommand
  | RpcDiscoverCommand
  | AgentGetProfileCommand
  | ClientTokenGetPolicyCommand;

export type BridgeCommand = RpcSingleCommand | RpcSingleCommand[];

export interface AgentCommandRequestBody {
  readonly agentId: string;
  readonly command: BridgeCommand;
  readonly timeoutMs?: number;
  readonly payloadFrameCompression?: PayloadFrameCompression;
}

export interface NormalizedRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: JsonObject;
}

export interface NormalizedRpcItem {
  readonly id?: JsonRpcId;
  readonly success: boolean;
  readonly result?: unknown;
  readonly error?: NormalizedRpcError;
  readonly api_version?: string;
  readonly meta?: RpcMeta;
}

export interface NormalizedRpcSingleResponse {
  readonly type: "single";
  readonly success: boolean;
  readonly item: NormalizedRpcItem;
  readonly api_version?: string;
  readonly meta?: RpcMeta;
}

export interface NormalizedRpcBatchResponse {
  readonly type: "batch";
  readonly success: boolean;
  readonly items: NormalizedRpcItem[];
}

export interface NormalizedRpcRawResponse {
  readonly type: "raw";
  readonly success: false;
  readonly payload: unknown;
}

export type NormalizedAgentRpcResponse =
  | NormalizedRpcSingleResponse
  | NormalizedRpcBatchResponse
  | NormalizedRpcRawResponse;

export interface RestBridgeCommandResponse {
  readonly mode: "bridge";
  readonly agentId: string;
  readonly requestId: string;
  readonly response: NormalizedAgentRpcResponse;
}

export interface RestBridgeNotificationResponse {
  readonly mode: "bridge";
  readonly agentId: string;
  readonly requestId: string;
  readonly notification: true;
  readonly acceptedCommands: number;
}

export interface PlugApiErrorResponse {
  readonly message?: string;
  readonly code?: string;
  readonly requestId?: string;
  readonly details?: JsonObject;
  readonly issues?: Array<{ readonly field?: string; readonly message?: string }>;
}

export interface RelayConnectionReadyPayload {
  readonly id: string;
  readonly message: string;
  readonly user: JsonObject;
}

export interface RelayConversationStartedPayload {
  readonly success: boolean;
  readonly conversationId?: string;
  readonly agentId?: string;
  readonly createdAt?: string;
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
    readonly statusCode?: number;
  };
}

export interface RelayRpcAcceptedSuccessPayload {
  readonly success: true;
  readonly conversationId: string;
  readonly requestId: string;
  readonly clientRequestId?: string;
  readonly deduplicated?: boolean;
  readonly replayed?: boolean;
  readonly inFlight?: boolean;
}

export interface RelayRpcAcceptedFailurePayload {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly statusCode?: number;
  };
}

export type RelayRpcAcceptedPayload =
  | RelayRpcAcceptedSuccessPayload
  | RelayRpcAcceptedFailurePayload;

export interface RelayStreamPullResponsePayload {
  readonly success: boolean;
  readonly conversationId?: string;
  readonly requestId?: string;
  readonly streamId?: string;
  readonly windowSize?: number;
  readonly rateLimit?: {
    readonly remainingCredits: number;
    readonly limit: number;
    readonly scope: "user" | "anon";
  };
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly statusCode?: number;
  };
}

export interface SocketAppErrorPayload {
  readonly code?: string;
  readonly message?: string;
  readonly details?: JsonObject;
}

export interface RestTransportResult {
  readonly channel: "rest";
  readonly agentId: string;
  readonly requestId: string;
  readonly notification: false;
  readonly response: NormalizedAgentRpcResponse;
  readonly raw: RestBridgeCommandResponse;
}

export interface RestTransportNotificationResult {
  readonly channel: "rest";
  readonly agentId: string;
  readonly requestId: string;
  readonly notification: true;
  readonly acceptedCommands: number;
  readonly raw: RestBridgeNotificationResponse;
}

export interface SocketTransportResult {
  readonly channel: "socket";
  readonly agentId: string;
  readonly requestId: string;
  readonly notification: false;
  readonly conversationId: string;
  readonly accepted: RelayRpcAcceptedSuccessPayload;
  readonly connectionReady: RelayConnectionReadyPayload;
  readonly response: NormalizedAgentRpcResponse;
  readonly rawResponsePayload: unknown;
  readonly chunkPayloads: JsonObject[];
  readonly completePayload?: JsonObject;
  readonly rawResponseFrame: PayloadFrameEnvelope;
  readonly rawChunkFrames: PayloadFrameEnvelope[];
  readonly rawCompleteFrame?: PayloadFrameEnvelope;
}

export type PlugCommandTransportResult =
  | RestTransportResult
  | RestTransportNotificationResult
  | SocketTransportResult;

export interface BuiltCommandRequest {
  readonly operation: PlugOperation;
  readonly channel: PlugChannel;
  readonly responseMode: PlugResponseMode;
  readonly command: BridgeCommand;
  readonly timeoutMs?: number;
  readonly payloadFrameCompression?: PayloadFrameCompression;
}
