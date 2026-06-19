export const DEFAULT_BASE_URL = "https://plug-server.se7esistemassinop.com.br/api/v1";
export const DEFAULT_API_VERSION = "2.8";
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
/** Max wait for socket `connection:ready` before failing the command (separate from idle command timeout). */
export const DEFAULT_SOCKET_CONNECT_TIMEOUT_MS = 10_000;
export const DEFAULT_RELAY_PULL_WINDOW = 256;
export const DEFAULT_CONSUMER_SOCKET_PULL_WINDOW = 256;
export const SOCKET_PROTOCOL_VERSION = "2026-05-14";

export type PlugChannel = "rest" | "socket";
export type PlugSocketImplementation = "agentsCommand" | "relay";
export type PlugResponseMode =
  | "aggregatedJson"
  | "aggregatedSingleItem"
  | "chunkItems"
  | "rawJsonRpc";

export const isSocketAggregatedResponseMode = (responseMode: PlugResponseMode): boolean =>
  responseMode === "aggregatedJson" || responseMode === "aggregatedSingleItem";
export type PlugInputMode = "guided" | "advanced";
export type PlugOperation =
  | "validateContext"
  | "executeSql"
  | "executeBatch"
  | "bulkInsertSql"
  | "cancelSql"
  | "discoverRpc"
  | "getAgentProfile"
  | "getClientTokenPolicy";

export type PlugCommandMethod =
  | "sql.execute"
  | "sql.executeBatch"
  | "sql.bulkInsert"
  | "sql.cancel"
  | "rpc.discover"
  | "agent.getProfile"
  | "client_token.getPolicy";

export type PayloadFrameCompression = "default" | "none" | "always";
export type JsonRpcId = string | number | null;
export type JsonObject = Record<string, unknown>;
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export interface PlugEmailPasswordCredentials {
  readonly user: string;
  readonly password: string;
  readonly baseUrl: string;
}

export type PlugClientAuthCredentials = PlugEmailPasswordCredentials;

export type PlugUserAuthCredentials = PlugEmailPasswordCredentials;

export interface PlugCredentialDefaults extends PlugClientAuthCredentials {
  readonly agentId?: string;
  readonly clientToken?: string;
  readonly payloadSigningKey?: string;
  readonly payloadSigningKeyId?: string;
  readonly payloadSigningPreviousKeysJson?: string;
}

export interface PlugPhaseTimings {
  readonly schemaVersion: number;
  readonly phasesMs: Record<string, number>;
}

export interface PlugServerTimings {
  readonly schemaVersion: number;
  readonly phasesMs: Record<string, number>;
  /** Agent-side sub-phases when the hub forwards `meta.agent_phases` or merges `agent_*` hub keys. */
  readonly agentPhases?: PlugPhaseTimings;
}

export type PlugCredentials = PlugCredentialDefaults;

export interface PlugResolvedExecutionContext extends PlugClientAuthCredentials {
  readonly resolvedAgentId: string;
  readonly resolvedClientToken?: string;
}

export interface PlugAuthTokensResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly success?: boolean;
  readonly token?: string;
}

export interface PlugUserProfile {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly [key: string]: unknown;
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

export interface PlugLoginResponse extends PlugAuthTokensResponse {
  readonly client: PlugClientProfile;
}

export interface PlugUserLoginResponse extends PlugAuthTokensResponse {
  readonly user: PlugUserProfile;
}

export type PlugAnyLoginResponse = PlugLoginResponse | PlugUserLoginResponse;

export interface PlugRefreshResponse extends PlugAuthTokensResponse {
  readonly client?: PlugClientProfile;
  readonly user?: PlugUserProfile;
}

export interface PlugSession<
  TCredentials extends PlugEmailPasswordCredentials = PlugCredentials,
  TLoginResponse extends PlugAnyLoginResponse = PlugLoginResponse,
> {
  readonly credentials: TCredentials;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly loginResponse: TLoginResponse;
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
  readonly prefer_db_streaming?: boolean;
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
    readonly max_parallel_read_only_batch_items?: number;
  };
}

export interface SqlExecuteBatchCommand extends RpcCommandBase {
  readonly method: "sql.executeBatch";
  readonly params: SqlExecuteBatchParams;
}

export interface SqlBulkInsertColumn extends JsonObject {
  readonly name: string;
  readonly type: string;
  readonly nullable?: boolean;
  readonly max_len?: number;
}

export interface SqlBulkInsertOptions extends JsonObject {
  readonly timeout_ms?: number;
}

export interface SqlBulkInsertParams extends JsonObject {
  readonly table: string;
  readonly columns: readonly SqlBulkInsertColumn[];
  readonly rows: readonly (readonly unknown[])[];
  readonly client_token?: string;
  readonly clientToken?: string;
  readonly auth?: string;
  readonly idempotency_key?: string;
  readonly database?: string;
  readonly options?: SqlBulkInsertOptions;
}

export interface SqlBulkInsertCommand extends RpcCommandBase {
  readonly method: "sql.bulkInsert";
  readonly params: SqlBulkInsertParams;
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
  | SqlBulkInsertCommand
  | SqlCancelCommand
  | RpcDiscoverCommand
  | AgentGetProfileCommand
  | ClientTokenGetPolicyCommand;

export type BridgeCommand = RpcSingleCommand | RpcSingleCommand[];

export interface AgentCommandRequestBody {
  readonly protocolVersion?: typeof SOCKET_PROTOCOL_VERSION;
  readonly requestId?: string;
  readonly clientRequestId?: string;
  readonly agentId: string;
  readonly command: BridgeCommand;
  readonly timeoutMs?: number;
  readonly pagination?: {
    readonly page: number;
    readonly pageSize: number;
  };
  readonly payloadFrameCompression?: PayloadFrameCompression;
  readonly requestServerTimings?: boolean;
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
    readonly retryAfterMs?: number;
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
    readonly retryAfterMs?: number;
  };
}

export type RelayRpcAcceptedPayload =
  | RelayRpcAcceptedSuccessPayload
  | RelayRpcAcceptedFailurePayload;

export interface RelayRpcBatchAcceptedItemSuccess {
  readonly clientRequestId: string;
  readonly requestId: string;
  readonly deduplicated?: boolean;
  readonly replayed?: boolean;
  readonly inFlight?: boolean;
}

export interface RelayRpcBatchAcceptedItemFailure {
  readonly clientRequestId: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly statusCode?: number;
    readonly itemIndex?: number;
  };
}

export type RelayRpcBatchAcceptedItem =
  | RelayRpcBatchAcceptedItemSuccess
  | RelayRpcBatchAcceptedItemFailure;

export interface RelayRpcBatchAcceptedSuccessPayload {
  readonly success: true;
  readonly conversationId: string;
  readonly batchSize: number;
  readonly items: RelayRpcBatchAcceptedItem[];
}

export interface RelayRpcBatchAcceptedFailurePayload {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly statusCode?: number;
    readonly details?: JsonObject;
  };
}

export type RelayRpcBatchAcceptedPayload =
  | RelayRpcBatchAcceptedSuccessPayload
  | RelayRpcBatchAcceptedFailurePayload;

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
    readonly retryAfterMs?: number;
  };
}

export interface SocketAppErrorPayload {
  readonly code?: string;
  readonly message?: string;
  readonly details?: JsonObject;
}

export interface ConsumerCommandSocketSuccessPayload {
  readonly success: true;
  readonly requestId: string;
  readonly clientRequestId?: string;
  readonly response: NormalizedAgentRpcResponse | ConsumerCommandNotificationResponse;
  readonly streamId?: string;
  readonly retryAfterSeconds?: number;
  readonly serverTimings?: PlugServerTimings;
}

export interface ConsumerCommandSocketFailurePayload {
  readonly success: false;
  readonly requestId?: string;
  readonly clientRequestId?: string;
  readonly streamId?: string;
  readonly serverTimings?: PlugServerTimings;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly statusCode?: number;
    readonly retryAfterMs?: number;
  };
}

export type ConsumerCommandSocketResponsePayload =
  | ConsumerCommandSocketSuccessPayload
  | ConsumerCommandSocketFailurePayload;

export interface ConsumerCommandNotificationResponse {
  readonly type: "notification";
  readonly accepted: boolean;
  readonly acceptedCommands: number;
}

export interface ConsumerCommandStreamChunkPayload extends JsonObject {
  readonly request_id?: string;
  readonly stream_id?: string;
}

export interface ConsumerCommandStreamCompletePayload extends JsonObject {
  readonly request_id?: string;
  readonly stream_id?: string;
  readonly terminal_status?: string;
}

export interface ConsumerCommandStreamPullResponseSuccessPayload {
  readonly success: true;
  readonly requestId: string;
  readonly streamId: string;
  readonly windowSize: number;
  readonly rateLimit?: {
    readonly remainingCredits: number;
    readonly limit: number;
    readonly scope: "user" | "anon";
  };
}

export interface ConsumerCommandStreamPullResponseFailurePayload {
  readonly success: false;
  readonly requestId?: string;
  readonly streamId?: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly statusCode?: number;
    readonly retryAfterMs?: number;
  };
  readonly rateLimit?: {
    readonly remainingCredits: number;
    readonly limit: number;
    readonly scope: "user" | "anon";
  };
}

export type ConsumerCommandStreamPullResponsePayload =
  | ConsumerCommandStreamPullResponseSuccessPayload
  | ConsumerCommandStreamPullResponseFailurePayload;

export interface RestTransportResult {
  readonly channel: "rest";
  readonly agentId: string;
  readonly requestId: string;
  readonly notification: false;
  readonly response: NormalizedAgentRpcResponse;
  readonly raw: RestBridgeCommandResponse;
  readonly executionMetrics?: PlugTransportExecutionMetrics;
}

export interface RestTransportNotificationResult {
  readonly channel: "rest";
  readonly agentId: string;
  readonly requestId: string;
  readonly notification: true;
  readonly acceptedCommands: number;
  readonly raw: RestBridgeNotificationResponse;
}

export interface SocketTransportNotificationResult {
  readonly channel: "socket";
  readonly socketMode: PlugSocketImplementation;
  readonly agentId: string;
  readonly requestId: string;
  readonly notification: true;
  readonly acceptedCommands: number;
  readonly connectionReady?: RelayConnectionReadyPayload;
  readonly metrics?: SocketCommandRuntimeMetrics;
  readonly executionMetrics?: PlugTransportExecutionMetrics;
}

export interface SocketCommandRuntimeMetrics extends JsonObject {
  readonly ignoredCommandResponses: number;
  readonly ignoredStreamChunks: number;
  readonly ignoredStreamCompletes: number;
  readonly ignoredStreamPullResponses: number;
  readonly streamPullRequests: number;
  readonly streamChunks: number;
  readonly bufferedBytes: number;
  readonly bufferedRows: number;
}

export interface PlugTransportExecutionMetrics {
  readonly attemptCount?: number;
  readonly lastRetryDelayMs?: number;
  readonly connectedAfterMs?: number;
  readonly serverTimings?: PlugServerTimings;
}

export interface SocketTransportResult {
  readonly channel: "socket";
  readonly socketMode: PlugSocketImplementation;
  readonly agentId: string;
  readonly requestId: string;
  readonly notification: false;
  readonly conversationId?: string;
  readonly accepted?: RelayRpcAcceptedSuccessPayload;
  readonly connectionReady?: RelayConnectionReadyPayload;
  readonly response: NormalizedAgentRpcResponse;
  readonly rawResponsePayload: unknown;
  readonly chunkPayloads: JsonObject[];
  readonly completePayload?: JsonObject;
  readonly rawResponseFrame?: unknown;
  readonly rawChunkFrames: unknown[];
  readonly rawCompleteFrame?: unknown;
  readonly metrics?: SocketCommandRuntimeMetrics;
  readonly executionMetrics?: PlugTransportExecutionMetrics;
}

export type PlugCommandTransportResult =
  | RestTransportResult
  | RestTransportNotificationResult
  | SocketTransportNotificationResult
  | SocketTransportResult;

export interface BuiltCommandRequest {
  readonly operation: PlugOperation;
  readonly agentId: string;
  readonly channel: PlugChannel;
  readonly socketImplementation?: PlugSocketImplementation;
  readonly responseMode: PlugResponseMode;
  readonly command: BridgeCommand;
  readonly timeoutMs?: number;
  readonly payloadFrameCompression?: PayloadFrameCompression;
  readonly bufferLimits?: {
    readonly maxBufferedChunkItems?: number;
    readonly maxBufferedRows?: number;
    readonly maxBufferedBytes?: number;
  };
  readonly streamPullWindowSize?: number;
  readonly fastPath?: boolean;
  readonly requestServerTimings?: boolean;
}
