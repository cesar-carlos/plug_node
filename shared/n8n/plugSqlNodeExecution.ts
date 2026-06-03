import type { IDataObject, IExecuteFunctions, INodeExecutionData } from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";

import type { JsonObject } from "../contracts/api";
import { createExecutionSessionRunner } from "../auth/session";
import {
  serializeErrorForContinueOnFail,
  toNodeFacingError,
} from "../output/errorOutput";
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
  const sourceItems = context.getInputData();
  const items =
    sourceItems.length > 0 ? sourceItems : [{ json: {} } as INodeExecutionData];
  const credentials = await readPlugClientCredentials(context, config);
  const requester = buildN8nHttpRequester(context);
  const sessionRunner = createExecutionSessionRunner(requester, credentials);
  const outputItems: INodeExecutionData[] = [];

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

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    try {
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
      outputItems.push(...toNodeItems(jsonItems));
    } catch (error: unknown) {
      if (context.continueOnFail()) {
        outputItems.push({
          json: {
            ...items[itemIndex].json,
            error: serializeErrorForContinueOnFail(error),
          },
          pairedItem: {
            item: itemIndex,
          },
        });
        continue;
      }

      throw new NodeOperationError(context.getNode(), toNodeFacingError(error), {
        itemIndex,
      });
    }
  }

  return [outputItems];
};
