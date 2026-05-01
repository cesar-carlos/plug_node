import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";

import { getInfrastructureSkipReason } from "./environmentSkips";

export interface ExecutableNode {
  execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]>;
}

export type SkipFunction = (reason: string) => never;

export const executeOrSkipInfrastructure = async (
  node: ExecutableNode,
  context: IExecuteFunctions,
  skip: SkipFunction,
): Promise<INodeExecutionData[][]> => {
  try {
    return await node.execute.call(context);
  } catch (error: unknown) {
    const skipReason = getInfrastructureSkipReason(error);
    if (skipReason) {
      skip(skipReason);
    }

    throw error;
  }
};
