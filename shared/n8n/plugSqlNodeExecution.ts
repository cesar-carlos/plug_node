import type { IDataObject, IExecuteFunctions, INodeExecutionData } from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";

import type { JsonObject } from "../contracts/api";
import { createExecutionSessionRunner } from "../auth/session";
import { toNodeFacingError } from "../output/errorOutput";
import { isRecord } from "../utils/json";
import { buildN8nHttpRequester } from "./httpRequester";
import {
  buildCoalescedBatchRequest,
  shouldCoalesceBatchInputItems,
} from "./plugBatchCoalesce";
import type { PlugClientNodeExecutionConfig } from "./plugClientExecutionTypes";
import {
  buildBuiltCommandRequest,
  finalizeBuiltCommandRequest,
  getPlugIncludeMetadata,
  readPlugClientCredentials,
  resolvePlugExecutionContext,
} from "./plugCommandRequestBuilder";
import { resolvePlugSqlInputItemParallelism } from "./plugInputItemParallelism";
import { executePerInputItem } from "./plugItemExecution";
import { executeBuiltCommandWithRetry } from "./plugTransportExecutor";

const toNodeItems = (jsonItems: JsonObject[]): INodeExecutionData[] =>
  jsonItems.map((json) => ({ json: json as IDataObject }));

const attachCoalescedItemCount = (
  jsonItems: JsonObject[],
  includeMetadata: boolean,
  coalescedItemCount: number,
): JsonObject[] => {
  if (!includeMetadata) {
    return jsonItems;
  }

  return jsonItems.map((json) => {
    const plugMeta = isRecord(json.__plug) ? json.__plug : {};
    return {
      ...json,
      __plug: {
        ...plugMeta,
        coalescedItemCount,
      },
    };
  });
};

export const executePlugSqlNode = async (
  context: IExecuteFunctions,
  config: PlugClientNodeExecutionConfig,
): Promise<INodeExecutionData[][]> => {
  const credentials = await readPlugClientCredentials(context, config);
  const requester = buildN8nHttpRequester(context);
  const sessionRunner = createExecutionSessionRunner(requester, credentials);

  if (shouldCoalesceBatchInputItems(context, 0)) {
    const includeMetadata = getPlugIncludeMetadata(context, 0);
    const { builtRequest, coalescedItemCount } = buildCoalescedBatchRequest({
      context,
      credentialDefaults: credentials,
      config,
      resolveExecutionContext: resolvePlugExecutionContext,
      finalizeBuiltRequest: finalizeBuiltCommandRequest,
    });
    const { jsonItems } = await executeBuiltCommandWithRetry({
      builtRequest,
      requester,
      sessionRunner,
      config,
      includeMetadata,
    });

    return [
      toNodeItems(
        attachCoalescedItemCount(jsonItems, includeMetadata, coalescedItemCount),
      ),
    ];
  }

  const sourceItems = context.getInputData();
  const maxConcurrency = resolvePlugSqlInputItemParallelism(context, sourceItems);

  return executePerInputItem(
    context,
    async (itemIndex) => {
      const builtRequest = buildBuiltCommandRequest(
        context,
        itemIndex,
        credentials,
        config,
      );
      const { jsonItems } = await executeBuiltCommandWithRetry({
        builtRequest,
        requester,
        sessionRunner,
        config,
        includeMetadata: getPlugIncludeMetadata(context, itemIndex),
      });
      return toNodeItems(jsonItems);
    },
    {
      maxConcurrency,
      onError: (error, itemIndex) =>
        new NodeOperationError(context.getNode(), toNodeFacingError(error), {
          itemIndex,
        }),
    },
  );
};
