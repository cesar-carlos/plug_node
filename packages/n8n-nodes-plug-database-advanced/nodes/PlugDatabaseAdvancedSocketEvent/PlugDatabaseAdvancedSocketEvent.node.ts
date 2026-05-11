import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";
import { NodeConnectionTypes } from "n8n-workflow";

import { buildPlugToolsSocketEventProperties } from "../../generated/shared/n8n/plugToolsDescription";
import { executePlugToolsSocketEventNode } from "../../generated/shared/n8n/plugToolsExecution";
import { serializeErrorForContinueOnFail } from "../../generated/shared/n8n/plugToolsCommon";
import { publishCustomSocketEventWithSocketIo } from "../PlugDatabaseAdvanced/customSocketEventPublisher";

const credentialName = "plugDatabaseAdvancedApi";
const legacyPublishOperation = "publishEvent";

export class PlugDatabaseAdvancedSocketEvent implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Plug Database Advanced Socket Event",
    name: "plugDatabaseAdvancedSocketEvent",
    icon: "file:plugDatabaseAdvancedSocketEvent.svg",
    group: ["transform"],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: "Publish custom Plug Socket events to subscribed consumers.",
    defaults: {
      name: "Plug Socket Event",
    },
    hidden: true,
    usableAsTool: true,
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: credentialName,
        required: true,
      },
    ],
    properties: [
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        default: legacyPublishOperation,
        noDataExpression: true,
        options: [
          {
            name: "Publish Socket Event",
            value: legacyPublishOperation,
            description: "Publish a client:custom.* event through Plug",
            action: "Publish a socket event",
          },
        ],
      },
      ...buildPlugToolsSocketEventProperties({
        supportsSocketPublish: true,
        operation: legacyPublishOperation,
      }),
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    try {
      return await executePlugToolsSocketEventNode(this, {
        credentialName,
        nodeDisplayName: this.getNode().name,
        socketEventPublisher: publishCustomSocketEventWithSocketIo,
      });
    } catch (error: unknown) {
      if (!this.continueOnFail()) {
        throw error;
      }

      return [
        [
          {
            json: {
              error: serializeErrorForContinueOnFail(error),
            },
            pairedItem: {
              item: 0,
            },
          },
        ],
      ];
    }
  }
}
