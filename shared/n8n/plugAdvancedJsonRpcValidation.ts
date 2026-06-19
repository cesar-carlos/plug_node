import type { z } from "zod";

import type { PlugCommandMethod, RpcSingleCommand } from "../contracts/api";
import { PlugValidationError } from "../contracts/errors";
import { advancedJsonRpcCommandSchema } from "./plugAdvancedJsonRpcMethodSchemas";

const formatZodIssuePath = (path: ReadonlyArray<string | number>): string =>
  path.length === 0 ? "command" : path.join(".");

const formatZodIssues = (issues: z.ZodIssue[]): string =>
  issues
    .slice(0, 4)
    .map((issue) => {
      const location = formatZodIssuePath(issue.path);
      return location === "command" ? issue.message : `${location}: ${issue.message}`;
    })
    .join("; ");

export const parseAdvancedJsonRpcCommand = (
  value: unknown,
  label = "Raw JSON-RPC Command",
): RpcSingleCommand => {
  const parsed = advancedJsonRpcCommandSchema.safeParse(value);
  if (!parsed.success) {
    throw new PlugValidationError(
      `${label} is invalid. ${formatZodIssues(parsed.error.issues)}`,
    );
  }

  return parsed.data as RpcSingleCommand;
};

export const assertAdvancedJsonRpcMethod = (
  command: RpcSingleCommand,
  expectedMethod: PlugCommandMethod,
  label = "Raw JSON-RPC Command",
): void => {
  if (command.method !== expectedMethod) {
    throw new PlugValidationError(
      `${label} method must be ${expectedMethod} for the selected operation`,
    );
  }
};
