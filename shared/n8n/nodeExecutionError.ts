import { NodeApiError, NodeOperationError } from "n8n-workflow";
import type { INode } from "n8n-workflow";

import { toNodeFacingError } from "../output/errorOutput";

export const toNodeExecutionError = (
  node: INode,
  error: unknown,
  itemIndex = 0,
): NodeApiError | NodeOperationError => {
  if (error instanceof NodeApiError || error instanceof NodeOperationError) return error;
  return new NodeOperationError(node, toNodeFacingError(error), { itemIndex });
};
