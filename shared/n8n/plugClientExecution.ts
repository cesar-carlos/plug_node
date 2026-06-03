import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";

import { PlugValidationError } from "../contracts/errors";
import { executePlugClientAccessNode } from "./plugClientAccessExecution";
import { executePlugToolsResource } from "./plugToolsExecution";
import { executePlugUserAccessNode } from "./plugUserAccessExecution";
import type { PlugClientNodeExecutionConfig } from "./plugClientExecutionTypes";
import { executePlugSqlNode } from "./plugSqlNodeExecution";

export type {
  PlugClientNodeExecutionConfig,
  PlugSocketExecutor,
} from "./plugClientExecutionTypes";

type PlugUnifiedResource = "sql" | "clientAccess" | "userAccess" | "tools";

const resolveUnifiedResource = (
  context: IExecuteFunctions,
  itemIndex: number,
): PlugUnifiedResource =>
  context.getNodeParameter("resource", itemIndex, "sql") as PlugUnifiedResource;

export const executePlugClientNode = async (
  context: IExecuteFunctions,
  config: PlugClientNodeExecutionConfig,
): Promise<INodeExecutionData[][]> => {
  const resource = resolveUnifiedResource(context, 0);
  const sourceItems = context.getInputData();
  const itemCount = sourceItems.length > 0 ? sourceItems.length : 1;

  for (let itemIndex = 1; itemIndex < itemCount; itemIndex += 1) {
    const nextResource = resolveUnifiedResource(context, itemIndex);
    if (nextResource !== resource) {
      throw new PlugValidationError(
        "Resource must stay the same for every item in one node execution.",
      );
    }
  }

  switch (resource) {
    case "sql":
      return executePlugSqlNode(context, config);
    case "clientAccess":
      return executePlugClientAccessNode(context, {
        credentialName: config.credentialName,
        nodeDisplayName: config.nodeDisplayName,
      });
    case "userAccess":
      return executePlugUserAccessNode(context, {
        credentialName: config.credentialName,
        nodeDisplayName: config.nodeDisplayName,
      });
    case "tools":
      return executePlugToolsResource(context, {
        credentialName: config.credentialName,
        nodeDisplayName: config.nodeDisplayName ?? "Plug Database",
        socketEventPublisher: config.toolSocketEventPublisher,
        socketEventListener: config.socketEventListener,
      });
    default: {
      const exhaustiveCheck: never = resource;
      throw new PlugValidationError(`Unsupported Plug resource: ${exhaustiveCheck}`);
    }
  }
};
