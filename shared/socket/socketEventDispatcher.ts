import type { PayloadFrameSigningOptions } from "../contracts/payload-frame";
import { PlugError, PlugValidationError } from "../contracts/errors";
import { isRecord } from "../utils/json";
import { decodePayloadFrameAsync } from "./payloadFrameCodec";
import {
  createParallelChunkDecodeQueue,
  type ParallelChunkDecodeQueue,
} from "./parallelChunkDecode";
import type { RelaySocketTransport } from "./relaySessionTypes";
import {
  resolveSocketBufferLimits,
  buildSocketBufferError,
  type SocketBufferLimits,
} from "./streamCommandSessionCommon";
import {
  rememberValidatedSocketPayload,
  forgetValidatedSocketPayload,
  signingContext,
} from "./validatedSocketPayload";
import { rememberConsumerWireBytes } from "./consumerCommandWireBytes";
import {
  normalizeRelayAcceptedPayload,
  normalizeRelayBatchAcceptedPayload,
  normalizeRelayConversationStarted,
  normalizeRelayStreamPullResponse,
} from "./relaySessionNormalization";

type Handler = (payload: unknown) => void;
interface ItemBudget {
  bytes: number;
  frames: number;
  pendingBytes: number;
  pendingFrames: number;
  streamId?: string;
}
interface Operation {
  readonly ids: Set<string>;
  readonly conversations: Set<string>;
  readonly handlers: Map<string, Handler | Set<Handler>>;
  limits: SocketBufferLimits;
  itemCount: number;
  readonly aliases: Map<string, string>;
  readonly items: Map<string, ItemBudget>;
  bytes: number;
  frames: number;
  pendingBytes: number;
  pendingFrames: number;
  disposed: boolean;
  generation: number;
  agentId?: string;
}
const connections = new WeakMap<RelaySocketTransport, SocketEventDispatcher>();
const operationTransports = new WeakSet<RelaySocketTransport>();
const dataEvents = new Set([
  "connection:ready",
  "agents:command_response",
  "agents:command_stream_chunk",
  "agents:command_stream_complete",
  "agents:stream_pull_response",
  "relay:rpc.response",
  "relay:rpc.chunk",
  "relay:rpc.complete",
]);
const terminalEvents = new Set(["app:error", "connect_error", "disconnect"]);
const controlReserveBytes = 64 * 1024;
const correlationKeys = ["clientRequestId", "requestId", "request_id", "id"] as const;

const idsFrom = (value: unknown): string[] => {
  if (!isRecord(value)) return [];
  const ids: string[] = [];
  for (let index = 0; index < correlationKeys.length; index++) {
    const id = value[correlationKeys[index]];
    if (typeof id === "string" && id) ids.push(id);
    else if (typeof id === "number" && Number.isFinite(id)) ids.push(String(id));
  }
  if (Array.isArray(value.items))
    for (const item of value.items) ids.push(...idsFrom(item));
  return ids;
};

/** Owns wire validation and decode concurrency for one physical connection. */
class SocketEventDispatcher {
  readonly operations = new Set<Operation>();
  private readonly requests = new Map<string, Operation>();
  private readonly idleOperations: Operation[] = [];
  readonly nativeHandlers = new Map<string, Handler>();
  private readonly listeningEvents = new Set<string>();
  private reservedBytes = 0;
  private reservedFrames = 0;
  private budgetBytes = controlReserveBytes;
  private budgetFrames = 64;
  private retainedBytes = 0;
  private closed = false;
  private readonly retiredIds = new Map<string, number>();
  private nextRetiredSweepAt = 0;
  private readonly reservations = new Set<{ owner?: Operation; cancel: () => void }>();
  private readonly context: string;
  private readonly signing?: PayloadFrameSigningOptions;
  readonly queue = createParallelChunkDecodeQueue({
    maxPendingBytes: Number.MAX_SAFE_INTEGER,
    maxPendingFrames: Number.MAX_SAFE_INTEGER,
    onError: (error) => this.fail(error),
  });

  constructor(
    readonly transport: RelaySocketTransport,
    signing?: PayloadFrameSigningOptions,
  ) {
    this.signing = signing
      ? Object.freeze({
          ...signing,
          previousKeys: signing.previousKeys
            ? Object.freeze(signing.previousKeys.map((key) => Object.freeze({ ...key })))
            : undefined,
        })
      : undefined;
    this.context = signingContext(this.signing);
  }

  matches(signing?: PayloadFrameSigningOptions): boolean {
    return !this.closed && this.context === signingContext(signing);
  }

  listen(event: string): void {
    if (this.listeningEvents.has(event)) return;
    const handler: Handler =
      this.nativeHandlers.get(event) ?? ((payload) => this.receive(event, payload));
    this.nativeHandlers.set(event, handler);
    this.listeningEvents.add(event);
    this.transport.on(event, handler);
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.queue.clearPendingDecodes();
    for (const event of this.listeningEvents)
      this.transport.off(event, this.nativeHandlers.get(event)!);
    this.listeningEvents.clear();
    this.nativeHandlers.clear();
    this.reservedBytes = 0;
    this.reservedFrames = 0;
    for (const reservation of this.reservations) reservation.cancel();
    this.reservations.clear();
    connections.delete(this.transport);
  }

  fail(error: unknown): void {
    if (this.closed) return;
    const failure =
      error instanceof PlugError
        ? error
        : new PlugValidationError(
            error instanceof Error ? error.message : "Invalid socket protocol event",
          );
    for (const operation of [...this.operations])
      void this.deliver(operation, "app:error", failure).catch(() => undefined);
    this.dispose();
  }

  private async deliver(
    operation: Operation,
    event: string,
    payload: unknown,
  ): Promise<void> {
    if (operation.disposed) return;
    const handlers = operation.handlers.get(event);
    if (!handlers) return;
    if (typeof handlers === "function") {
      const completion: unknown = handlers(payload);
      if (completion) await completion;
      return;
    }
    if (handlers.size === 1) {
      const handler = handlers.values().next().value;
      const completion: unknown = handler?.(payload);
      if (completion) await completion;
      return;
    }
    const completions: unknown[] = [];
    for (const handler of [...handlers]) completions.push(handler(payload));
    await Promise.all(completions);
  }

  private findOwner(ids: readonly string[]): Operation | undefined {
    let owner: Operation | undefined;
    for (let index = 0; index < ids.length; index++) {
      const found = this.requests.get(ids[index]);
      if (!found) continue;
      if (owner && owner !== found)
        throw new PlugValidationError("Socket event matches multiple pending commands.");
      owner = found;
    }
    return owner;
  }

  private itemFor(operation: Operation, ids: readonly string[]): string | undefined {
    for (let index = 0; index < ids.length; index++) {
      const item = operation.aliases.get(ids[index]);
      if (item) return item;
    }
    return undefined;
  }

  private adoptAliases(operation: Operation, ids: string[], data: unknown): void {
    const adopt = (ids: string[]): void => {
      const item =
        this.itemFor(operation, ids) ??
        (operation.items.size === 1 ? operation.items.keys().next().value : undefined);
      for (let index = 0; index < ids.length; index++) {
        const id = ids[index];
        const existing = this.requests.get(id);
        if (existing && existing !== operation)
          throw new PlugValidationError(
            "Socket request alias belongs to another command.",
          );
        operation.ids.add(id);
        this.requests.set(id, operation);
        if (item) operation.aliases.set(id, item);
      }
    };
    if (isRecord(data) && Array.isArray(data.items)) {
      for (const item of data.items) adopt(idsFrom(item));
    } else adopt(ids);
  }

  private async distribute(
    event: string,
    payload: unknown,
    data: unknown,
    bytes: number,
  ): Promise<void> {
    if (this.closed) return;
    if (event === "connection:ready" || terminalEvents.has(event)) {
      const completions = [...this.operations].map((operation) =>
        this.deliver(operation, event, payload),
      );
      if (terminalEvents.has(event)) this.dispose();
      await Promise.all(completions);
      return;
    }
    const ids = [...idsFrom(payload), ...idsFrom(data)];
    const now = Date.now();
    if (now >= this.nextRetiredSweepAt) {
      for (const [id, expiry] of this.retiredIds)
        if (expiry <= now) this.retiredIds.delete(id);
      this.nextRetiredSweepAt = now + 60_000;
    }
    let owner = this.findOwner(ids);
    if (!owner && ids.some((id) => this.retiredIds.has(id))) return;
    const conversation =
      isRecord(data) && typeof data.conversationId === "string"
        ? data.conversationId
        : undefined;
    if (!owner && conversation !== undefined) {
      for (const operation of this.operations) {
        if (!operation.conversations.has(conversation)) continue;
        if (owner)
          throw new PlugValidationError(
            "Socket conversation matches multiple pending commands.",
          );
        owner = operation;
      }
    }
    const startingAgent =
      event === "relay:conversation.started" &&
      isRecord(data) &&
      typeof data.agentId === "string"
        ? data.agentId
        : undefined;
    if (!owner && startingAgent !== undefined) {
      for (const operation of this.operations) {
        if (operation.agentId !== startingAgent) continue;
        if (owner)
          throw new PlugValidationError(
            "Socket conversation start matches multiple pending commands.",
          );
        owner = operation;
      }
    }
    // A direct session can still observe unrelated correlated events for its
    // diagnostic counters. Never assign one mutable event to multiple owners.
    if (
      !owner &&
      this.operations.size === 1 &&
      (dataEvents.has(event) || ids.length === 0)
    )
      owner = this.operations.values().next().value;
    if (!owner) {
      if (ids.length === 0)
        this.fail(
          new PlugValidationError(
            "Socket event cannot be assigned to a unique pending command.",
          ),
        );
      return;
    }
    const matched =
      ids.some((id) => owner.ids.has(id)) ||
      (startingAgent !== undefined && owner.agentId === startingAgent) ||
      (conversation !== undefined &&
        owner.conversations.has(conversation) &&
        !dataEvents.has(event));
    if (matched) {
      this.adoptAliases(owner, ids, data);
      if (conversation) owner.conversations.add(conversation);
      const itemId = this.itemFor(owner, ids);
      const item = itemId ? owner.items.get(itemId) : undefined;
      if (item && isRecord(data)) {
        const response = isRecord(data.response) ? data.response : data;
        const result =
          isRecord(response.item) && isRecord(response.item.result)
            ? response.item.result
            : isRecord(response.result)
              ? response.result
              : undefined;
        const stream =
          typeof data.streamId === "string" ? data.streamId : result?.stream_id;
        if (typeof stream === "string" && stream) item.streamId = stream;
        if (
          (event.endsWith("chunk") || event.endsWith("complete")) &&
          item.streamId &&
          typeof data.stream_id === "string" &&
          data.stream_id !== item.streamId
        ) {
          return this.deliver(owner, event, payload);
        }
      }
      if (
        (event.endsWith("response") && !event.includes("pull")) ||
        event.endsWith("chunk")
      ) {
        if (item) {
          item.bytes += bytes;
          if (event.endsWith("chunk")) item.frames++;
        }
        owner.bytes += bytes;
        this.retainedBytes += bytes;
        if (event.endsWith("chunk")) owner.frames++;
        if (
          (item &&
            (item.bytes + item.pendingBytes > owner.limits.maxBufferedBytes ||
              item.frames + item.pendingFrames > owner.limits.maxBufferedChunkItems)) ||
          owner.bytes + owner.pendingBytes >
            owner.limits.maxBufferedBytes * owner.itemCount ||
          owner.frames + owner.pendingFrames >
            owner.limits.maxBufferedChunkItems * owner.itemCount
        ) {
          await this.deliver(
            owner,
            "app:error",
            buildSocketBufferError({
              ...owner.limits,
              bufferedBytes: owner.bytes,
              bufferedRows: 0,
              chunkCount: owner.frames,
            }),
          );
          return;
        }
      }
    }
    return this.deliver(owner, event, payload);
  }

  private receive(event: string, payload: unknown): void {
    if (this.closed) return;
    if (terminalEvents.has(event)) {
      void this.distribute(event, payload, payload, 0).catch((error) => this.fail(error));
      return;
    }
    if (!dataEvents.has(event)) {
      try {
        if (event === "relay:rpc.accepted") normalizeRelayAcceptedPayload(payload);
        else if (event === "relay:rpc.batch_accepted")
          normalizeRelayBatchAcceptedPayload(payload);
        else if (event === "relay:conversation.started")
          normalizeRelayConversationStarted(payload);
        else if (event === "relay:rpc.stream.pull_response")
          normalizeRelayStreamPullResponse(payload);
        const controlBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
        if (controlBytes > controlReserveBytes) {
          this.fail(
            buildSocketBufferError({
              maxBufferedBytes: controlReserveBytes,
              maxBufferedRows: 0,
              maxBufferedChunkItems: 64,
              bufferedBytes: controlBytes,
              bufferedRows: 0,
              chunkCount: 1,
            }),
          );
          return;
        }
        void this.distribute(event, payload, payload, 0).catch((error) =>
          this.fail(error),
        );
      } catch (error) {
        this.fail(error);
      }
      return;
    }
    const frame = isRecord(payload) && "schemaVersion" in payload;
    let bytes: number;
    try {
      bytes =
        frame && typeof payload.originalSize === "number"
          ? payload.originalSize
          : Buffer.byteLength(JSON.stringify(payload), "utf8");
      if (!Number.isFinite(bytes) || bytes < 0)
        throw new PlugValidationError("Invalid socket frame size.");
    } catch (error) {
      this.fail(error);
      return;
    }
    if (!frame) rememberConsumerWireBytes(payload, bytes);
    const headerIds = idsFrom(payload);
    let owner: Operation | undefined;
    try {
      owner = this.findOwner(headerIds);
    } catch (error) {
      this.fail(error);
      return;
    }
    const itemId = owner ? this.itemFor(owner, headerIds) : undefined;
    const item = itemId ? owner?.items.get(itemId) : undefined;
    const chunk = event.endsWith("chunk");
    const retained = chunk || (event.endsWith("response") && !event.includes("pull"));
    if (
      owner &&
      retained &&
      ((item &&
        (item.bytes + item.pendingBytes + bytes > owner.limits.maxBufferedBytes ||
          item.frames + item.pendingFrames + (chunk ? 1 : 0) >
            owner.limits.maxBufferedChunkItems)) ||
        owner.bytes + owner.pendingBytes + bytes >
          owner.limits.maxBufferedBytes * owner.itemCount ||
        owner.frames + owner.pendingFrames + (chunk ? 1 : 0) >
          owner.limits.maxBufferedChunkItems * owner.itemCount)
    ) {
      void this.deliver(
        owner,
        "app:error",
        buildSocketBufferError({
          ...owner.limits,
          bufferedBytes: owner.bytes + owner.pendingBytes + bytes,
          bufferedRows: 0,
          chunkCount: owner.frames + owner.pendingFrames + (chunk ? 1 : 0),
        }),
      ).catch((error) => this.fail(error));
      return;
    }
    const budget = this.budgetBytes;
    const frameBudget = this.budgetFrames;
    const accumulated = this.retainedBytes;
    if (
      accumulated + this.reservedBytes + bytes > budget ||
      this.reservedFrames + 1 > frameBudget
    ) {
      this.fail(
        buildSocketBufferError({
          maxBufferedBytes: budget,
          maxBufferedChunkItems: frameBudget,
          maxBufferedRows: Number.MAX_SAFE_INTEGER,
          bufferedBytes: accumulated + this.reservedBytes + bytes,
          bufferedRows: 0,
          chunkCount: this.reservedFrames + 1,
        }),
      );
      return;
    }
    this.reservedBytes += bytes;
    this.reservedFrames++;
    if (owner && retained) {
      owner.pendingBytes += bytes;
      if (chunk) owner.pendingFrames++;
    }
    if (item && retained) {
      item.pendingBytes += bytes;
      if (chunk) item.pendingFrames++;
    }
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      if (!this.closed) {
        this.reservedBytes -= bytes;
        this.reservedFrames--;
      }
      if (owner && retained) {
        owner.pendingBytes -= bytes;
        if (chunk) owner.pendingFrames--;
      }
      if (item && retained) {
        item.pendingBytes -= bytes;
        if (chunk) item.pendingFrames--;
      }
      this.reservations.delete(reservation);
    };
    const cancellation = new AbortController();
    const reservation = {
      owner,
      cancel: (): void => {
        release();
        cancellation.abort();
      },
    };
    this.reservations.add(reservation);
    void this.queue.enqueueDecodeThenOrdered(
      async () => {
        if (frame) {
          // Each arrival is validated anew. A private delivery object scopes the
          // cached validation to this event, even if a transport reuses objects.
          const decoded = await decodePayloadFrameAsync(payload, {
            signing: this.signing,
            validateSignature: () => undefined,
          });
          const wire = {
            schemaVersion: "1.0",
            enc: "json",
            originalSize: decoded.frame.originalSize,
            requestId: decoded.frame.requestId,
          };
          if (!cancellation.signal.aborted)
            rememberValidatedSocketPayload(wire, decoded, this.signing);
          return { data: decoded.data, wire };
        }
        if (this.signing?.requireSignature && event.startsWith("agents:"))
          throw new PlugValidationError("PayloadFrame signature is required");
        return { data: payload, wire: payload };
      },
      async ({ data, wire }) => {
        release();
        try {
          await this.distribute(event, wire, data, bytes);
        } finally {
          forgetValidatedSocketPayload(wire);
        }
      },
      bytes,
      cancellation.signal,
    );
  }

  register(
    ids: readonly string[],
    limits: SocketBufferLimits,
    conversationId?: string,
    agentId?: string,
  ): {
    transport: RelaySocketTransport;
    signing?: PayloadFrameSigningOptions;
    dispose: () => void;
    metrics: () => {
      decodes: number;
      peakPendingFrames: number;
      peakPendingBytes: number;
    };
    canReceive: () => boolean;
    drain: () => Promise<void>;
  } {
    for (const id of ids) {
      if (this.requests.has(id))
        throw new PlugValidationError(
          "A socket command with this request id is already registered.",
        );
    }
    const operation: Operation = this.idleOperations.pop() ?? {
      ids: new Set(),
      conversations: new Set(),
      handlers: new Map(),
      limits,
      itemCount: 1,
      aliases: new Map(),
      items: new Map(),
      bytes: 0,
      frames: 0,
      pendingBytes: 0,
      pendingFrames: 0,
      disposed: true,
      generation: 0,
    };
    operation.limits = limits;
    operation.agentId = agentId;
    operation.itemCount = Math.max(1, ids.length);
    operation.disposed = false;
    operation.generation++;
    const generation = operation.generation;
    for (let index = 0; index < ids.length; index++) {
      const id = ids[index];
      operation.ids.add(id);
      operation.aliases.set(id, id);
      operation.items.set(id, { bytes: 0, frames: 0, pendingBytes: 0, pendingFrames: 0 });
    }
    if (conversationId) operation.conversations.add(conversationId);
    for (const id of ids) this.retiredIds.delete(id);
    for (const id of ids) this.requests.set(id, operation);
    this.operations.add(operation);
    this.budgetBytes += limits.maxBufferedBytes * operation.itemCount;
    this.budgetFrames += limits.maxBufferedChunkItems * operation.itemCount;
    for (const event of terminalEvents) this.listen(event);
    const getConnected = (): boolean => this.transport.connected;
    const transport: RelaySocketTransport = {
      get connected() {
        return (
          operation.generation === generation && !operation.disposed && getConnected()
        );
      },
      connect: () => {
        if (operation.generation === generation && !operation.disposed)
          this.transport.connect();
      },
      disconnect: () => {
        if (operation.generation === generation && !operation.disposed)
          this.transport.disconnect();
      },
      on: (event, handler) => {
        if (operation.generation !== generation || operation.disposed) return;
        const handlers = operation.handlers.get(event);
        if (!handlers) operation.handlers.set(event, handler);
        else if (typeof handlers === "function") {
          if (handlers !== handler)
            operation.handlers.set(event, new Set([handlers, handler]));
        } else handlers.add(handler);
        this.listen(event);
      },
      off: (event, handler) => {
        if (operation.generation !== generation || operation.disposed) return;
        const handlers = operation.handlers.get(event);
        if (handlers === handler) operation.handlers.delete(event);
        else if (handlers instanceof Set) {
          handlers.delete(handler);
          if (!handlers.size) operation.handlers.delete(event);
        }
      },
      emit: (event, payload) => {
        if (operation.disposed || operation.generation !== generation) return;
        for (const id of idsFrom(payload)) {
          const existing = this.requests.get(id);
          if (existing && existing !== operation)
            throw new PlugValidationError(
              "Socket dispatch alias belongs to another pending command.",
            );
          operation.ids.add(id);
          this.requests.set(id, operation);
        }
        if (isRecord(payload) && typeof payload.conversationId === "string")
          operation.conversations.add(payload.conversationId);
        this.transport.emit(event, payload);
      },
    };
    operationTransports.add(transport);
    return {
      transport,
      signing: this.signing,
      metrics: () => ({
        decodes: this.queue.metrics.decodes,
        peakPendingFrames: this.queue.metrics.peakPendingFrames,
        peakPendingBytes: this.queue.metrics.peakPendingBytes,
      }),
      drain: () => this.queue.drainOrderedWork(),
      canReceive: () =>
        operation.generation === generation &&
        !operation.disposed &&
        operation.bytes + operation.pendingBytes <
          limits.maxBufferedBytes * operation.itemCount &&
        operation.frames + operation.pendingFrames <
          limits.maxBufferedChunkItems * operation.itemCount &&
        this.retainedBytes + this.reservedBytes < this.budgetBytes &&
        this.reservedFrames < this.budgetFrames,
      dispose: () => {
        if (operation.disposed || operation.generation !== generation) return;
        operation.disposed = true;
        for (const reservation of [...this.reservations])
          if (reservation.owner === operation) reservation.cancel();
        operation.handlers.clear();
        const expiresAt = Date.now() + 60_000;
        operation.ids.forEach((id) => {
          this.retiredIds.set(id, expiresAt);
          if (this.requests.get(id) === operation) this.requests.delete(id);
        });
        while (this.retiredIds.size > 1024) {
          const oldest = this.retiredIds.keys().next().value;
          if (oldest === undefined) break;
          this.retiredIds.delete(oldest);
        }
        this.retainedBytes -= operation.bytes;
        this.budgetBytes -= operation.limits.maxBufferedBytes * operation.itemCount;
        this.budgetFrames -= operation.limits.maxBufferedChunkItems * operation.itemCount;
        operation.bytes = 0;
        operation.frames = 0;
        operation.pendingBytes = 0;
        operation.pendingFrames = 0;
        operation.ids.clear();
        operation.conversations.clear();
        operation.aliases.clear();
        operation.items.clear();
        this.operations.delete(operation);
        if (this.idleOperations.length < 8) this.idleOperations.push(operation);
        if (!this.operations.size) {
          for (const reservation of [...this.reservations]) reservation.cancel();
          this.listeningEvents.forEach((event) =>
            this.transport.off(event, this.nativeHandlers.get(event)!),
          );
          this.listeningEvents.clear();
        }
      },
    };
  }
}

export const registerSocketCommand = (input: {
  readonly transport: RelaySocketTransport;
  readonly ids: readonly string[];
  readonly conversationId?: string;
  readonly agentId?: string;
  readonly signing?: PayloadFrameSigningOptions;
  readonly bufferLimits?: Partial<SocketBufferLimits>;
}): ReturnType<SocketEventDispatcher["register"]> => {
  let dispatcher = connections.get(input.transport);
  if (dispatcher && !dispatcher.matches(input.signing)) {
    if (dispatcher.operations.size)
      throw new PlugValidationError(
        "Socket signing context changed while commands are pending. Create a new connection.",
      );
    dispatcher.dispose();
    dispatcher = undefined;
  }
  if (!dispatcher) {
    dispatcher = new SocketEventDispatcher(input.transport, input.signing);
    connections.set(input.transport, dispatcher);
  }
  return dispatcher.register(
    input.ids,
    resolveSocketBufferLimits(input.bufferLimits),
    input.conversationId,
    input.agentId,
  );
};

/** The connection already orders decoded events; direct sessions retain their local queue. */
export const applySocketDecodeInOrder = async <T>(
  transport: RelaySocketTransport,
  queue: ParallelChunkDecodeQueue,
  decode: () => Promise<T>,
  apply: (value: T) => Promise<void> | void,
): Promise<void> => {
  if (operationTransports.has(transport)) {
    await apply(await decode());
    return;
  }
  await queue.enqueueDecodeThenOrdered(decode, apply);
};

export const isSocketEventDispatchTransport = (
  transport: RelaySocketTransport,
): boolean => operationTransports.has(transport);

export const disposeSocketEventDispatcher = (transport: RelaySocketTransport): void => {
  const dispatcher = connections.get(transport);
  dispatcher?.fail(
    new PlugError("Socket connection closed", {
      code: "SOCKET_DISCONNECTED",
      details: { commandDispatched: true },
    }),
  );
};
