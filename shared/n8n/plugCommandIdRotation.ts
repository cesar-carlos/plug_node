import { randomUUID } from "node:crypto";

import type {
  BridgeCommand,
  BuiltCommandRequest,
  RpcSingleCommand,
} from "../contracts/api";
import { getPlugOperationRetryKind } from "./plugTransientRetry";

const rotateSingleCommandId = (command: RpcSingleCommand): RpcSingleCommand => ({
  ...command,
  id: randomUUID(),
});

/** Fresh JSON-RPC ids on transient retry avoid hub replay_detected (-32014). */
export const rotateBuiltRequestCommandIdsForRetry = (
  builtRequest: BuiltCommandRequest,
  attemptNumber: number,
): BuiltCommandRequest => {
  if (attemptNumber === 0) {
    return builtRequest;
  }

  if (getPlugOperationRetryKind(builtRequest.operation) === undefined) {
    return builtRequest;
  }

  const command: BridgeCommand = Array.isArray(builtRequest.command)
    ? builtRequest.command.map((entry) => rotateSingleCommandId(entry))
    : rotateSingleCommandId(builtRequest.command);

  return {
    ...builtRequest,
    command,
  };
};
