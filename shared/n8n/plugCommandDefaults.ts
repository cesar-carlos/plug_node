import { DEFAULT_API_VERSION } from "../contracts/api";
import type {
  JsonObject,
  PlugResolvedExecutionContext,
  RpcSingleCommand,
} from "../contracts/api";

export const applyCommandDefaults = (
  command: RpcSingleCommand,
  executionContext: PlugResolvedExecutionContext,
  apiVersion?: string,
  meta?: JsonObject,
): RpcSingleCommand => {
  const nextCommand: RpcSingleCommand = {
    ...command,
    jsonrpc: "2.0",
    api_version: apiVersion ?? command.api_version ?? DEFAULT_API_VERSION,
    ...(meta ? { meta: meta } : command.meta ? { meta: command.meta } : {}),
  } as RpcSingleCommand;

  if (nextCommand.method === "sql.execute") {
    return {
      ...nextCommand,
      params: {
        ...nextCommand.params,
        client_token: executionContext.resolvedClientToken,
      },
    };
  }

  if (nextCommand.method === "sql.executeBatch") {
    return {
      ...nextCommand,
      params: {
        ...nextCommand.params,
        client_token: executionContext.resolvedClientToken,
      },
    };
  }

  if (nextCommand.method === "sql.bulkInsert") {
    return {
      ...nextCommand,
      params: {
        ...nextCommand.params,
        client_token: executionContext.resolvedClientToken,
      },
    };
  }

  if (
    nextCommand.method === "agent.getProfile" ||
    nextCommand.method === "client_token.getPolicy"
  ) {
    return {
      ...nextCommand,
      params: {
        ...(nextCommand.params ?? {}),
        client_token: executionContext.resolvedClientToken,
      },
    };
  }

  return nextCommand;
};
