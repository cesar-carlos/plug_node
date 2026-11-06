import type { IExecuteFunctions } from "n8n-workflow";

import type {
  BuiltCommandRequest,
  PlugCredentialDefaults,
  PlugResolvedExecutionContext,
  SqlExecuteBatchCommandItem,
} from "../contracts/api";
import { PlugValidationError } from "../contracts/errors";
import { parseOptionalJsonArray } from "../utils/json";
import type { PlugClientNodeExecutionConfig } from "./plugClientExecutionTypes";
import { toCollection, toOptionalBoolean } from "./plugExecutionParameters";
import {
  buildGuidedBatchCommand,
  mapGuidedBatchCommandItems,
} from "./plugSqlGuidedCommands";

export const MAX_COALESCED_BATCH_COMMANDS = 32;

const stableSerialize = (value: unknown): string => JSON.stringify(value ?? {});

export const shouldCoalesceBatchInputItems = (
  context: IExecuteFunctions,
  itemIndex: number,
): boolean => {
  if (context.continueOnFail()) return false;
  const operation = context.getNodeParameter("operation", itemIndex) as string;
  if (operation !== "executeBatch") {
    return false;
  }

  const inputMode = context.getNodeParameter("inputMode", itemIndex, "guided") as string;
  if (inputMode !== "guided") {
    return false;
  }

  const batchOptions = toCollection(context, "batchOptions", itemIndex);
  if ("coalesceInputItems" in batchOptions) {
    return toOptionalBoolean(batchOptions.coalesceInputItems) === true;
  }

  const autoPerformanceHints =
    toOptionalBoolean(batchOptions.autoPerformanceHints) ?? true;
  return autoPerformanceHints;
};

export const buildCoalescedBatchRequest = (input: {
  readonly context: IExecuteFunctions;
  readonly credentialDefaults: PlugCredentialDefaults;
  readonly config: PlugClientNodeExecutionConfig;
  readonly resolveExecutionContext: (
    context: IExecuteFunctions,
    itemIndex: number,
    credentialDefaults: PlugCredentialDefaults,
    operation: string,
  ) => PlugResolvedExecutionContext;
  readonly finalizeBuiltRequest: (
    builtRequest: BuiltCommandRequest,
    context: IExecuteFunctions,
    itemIndex: number,
    config: PlugClientNodeExecutionConfig,
  ) => BuiltCommandRequest;
}): {
  readonly builtRequest: BuiltCommandRequest;
  readonly coalescedItemCount: number;
} => {
  const sourceItems = input.context.getInputData();
  const itemCount = sourceItems.length > 0 ? sourceItems.length : 1;
  const referenceOptions = stableSerialize(
    toCollection(input.context, "batchOptions", 0),
  );
  const serializeBatchOptions = (itemIndex: number): string =>
    itemIndex === 0
      ? referenceOptions
      : stableSerialize(toCollection(input.context, "batchOptions", itemIndex));

  const mergedCommands: SqlExecuteBatchCommandItem[] = [];
  const batchOptions = toCollection(input.context, "batchOptions", 0);
  const requireWhereForUpdateDelete =
    toOptionalBoolean(batchOptions.requireWhereForUpdateDelete) ?? true;
  const executionContext = input.resolveExecutionContext(
    input.context,
    0,
    input.credentialDefaults,
    "executeBatch",
  );
  const channel = input.config.supportsSocket
    ? input.context.getNodeParameter("channel", 0, "rest")
    : "rest";

  for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
    if (
      input.context.getNodeParameter("operation", itemIndex) !== "executeBatch" ||
      input.context.getNodeParameter("inputMode", itemIndex, "guided") !== "guided" ||
      (input.config.supportsSocket &&
        input.context.getNodeParameter("channel", itemIndex, "rest") !== channel)
    ) {
      throw new PlugValidationError(
        "Coalesce Input Items requires guided Execute Batch with the same channel on every item. Disable coalescing for mixed items.",
      );
    }
    if (itemIndex > 0) {
      const itemContext = input.resolveExecutionContext(
        input.context,
        itemIndex,
        input.credentialDefaults,
        "executeBatch",
      );
      if (
        itemContext.resolvedAgentId !== executionContext.resolvedAgentId ||
        itemContext.resolvedClientToken !== executionContext.resolvedClientToken
      ) {
        throw new PlugValidationError(
          "Coalesce Input Items requires the same agent and client credential on every item. Disable coalescing for different destinations or credentials.",
        );
      }
      const itemOptions = serializeBatchOptions(itemIndex);
      if (itemOptions !== referenceOptions) {
        throw new PlugValidationError(
          "Coalesce Input Items requires identical Additional Options on every input item. Use item 0 options for all items or disable coalescing.",
        );
      }
    }

    const batchCommandsJson = input.context.getNodeParameter(
      "batchCommandsJson",
      itemIndex,
    ) as string;
    const commands = parseOptionalJsonArray(batchCommandsJson, "Batch Commands JSON");
    if (!commands || commands.length === 0) {
      throw new PlugValidationError(
        `Batch Commands JSON on input item ${itemIndex} must contain at least one command when coalescing.`,
      );
    }

    if (mergedCommands.length + commands.length > MAX_COALESCED_BATCH_COMMANDS) {
      throw new PlugValidationError(
        `Coalesced batch exceeds ${MAX_COALESCED_BATCH_COMMANDS} commands. Split the workflow or disable Coalesce Input Items.`,
      );
    }
    mergedCommands.push(
      ...mapGuidedBatchCommandItems(commands, requireWhereForUpdateDelete),
    );
  }

  const builtRequest = buildGuidedBatchCommand(
    input.context,
    0,
    executionContext,
    mergedCommands,
  );

  return {
    builtRequest: input.finalizeBuiltRequest(
      builtRequest,
      input.context,
      0,
      input.config,
    ),
    coalescedItemCount: itemCount,
  };
};
