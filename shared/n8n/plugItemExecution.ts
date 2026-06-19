import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";

import {
  serializeErrorForContinueOnFail,
  toNodeFacingError,
} from "../output/errorOutput";
import { isRecord } from "../utils/json";

export const emptyInputItem: INodeExecutionData = { json: {} };

export interface ExecutePerInputItemOptions {
  readonly useEmptyInputWhenNoItems?: boolean;
  readonly onError?: (error: unknown, itemIndex: number) => NodeOperationError | Error;
}

const toNodeItems = (
  results: INodeExecutionData | INodeExecutionData[],
): INodeExecutionData[] => (Array.isArray(results) ? [...results] : [results]);

export const executePerInputItem = async (
  context: IExecuteFunctions,
  executeItem: (
    itemIndex: number,
    item: INodeExecutionData,
  ) => Promise<INodeExecutionData | INodeExecutionData[]>,
  options?: ExecutePerInputItemOptions,
): Promise<INodeExecutionData[][]> => {
  const sourceItems = context.getInputData();
  const useEmptyInput = options?.useEmptyInputWhenNoItems !== false;
  const items =
    sourceItems.length > 0 ? sourceItems : useEmptyInput ? [emptyInputItem] : sourceItems;
  const outputItems: INodeExecutionData[] = [];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex];
    try {
      const result = await executeItem(itemIndex, item);
      outputItems.push(...toNodeItems(result));
    } catch (error: unknown) {
      if (context.continueOnFail()) {
        outputItems.push({
          json: {
            ...item.json,
            error: serializeErrorForContinueOnFail(error),
          },
          pairedItem: {
            item: itemIndex,
          },
        });
        continue;
      }

      const nodeError =
        options?.onError?.(error, itemIndex) ??
        new NodeOperationError(context.getNode(), toNodeFacingError(error), {
          itemIndex,
        });
      throw nodeError;
    }
  }

  return [outputItems];
};

export const toAccessNodeOperationError = (
  context: IExecuteFunctions,
  error: unknown,
  itemIndex: number,
  nodeDisplayName: string,
): NodeOperationError => {
  const nodeError =
    error instanceof Error || typeof error === "string"
      ? error
      : isRecord(error)
        ? JSON.stringify(error)
        : new Error(`Unknown ${nodeDisplayName} error`);

  return new NodeOperationError(context.getNode(), nodeError, {
    itemIndex,
  });
};
