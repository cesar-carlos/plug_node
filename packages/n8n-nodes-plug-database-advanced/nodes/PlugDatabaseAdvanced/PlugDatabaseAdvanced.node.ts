import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";

import { buildPlugClientNodeDescription } from "../../generated/shared/n8n/plugClientDescription";
import { executePlugClientNode } from "../../generated/shared/n8n/plugClientExecution";
import { waitForCustomSocketEventWithSocketIo } from "./customSocketEventListener";
import { publishCustomSocketEventWithSocketIo } from "./customSocketEventPublisher";
import { createSocketCommandExecutor } from "./socketCommandExecutor";
import { executeSocketCommand as executeLegacySocketCommand } from "./socketRelayExecutor";

export class PlugDatabaseAdvanced implements INodeType {
  description: INodeTypeDescription = {
    ...buildPlugClientNodeDescription({
      supportsSocket: true,
      supportsSocketEventSocketPublish: true,
      supportsSocketEventSocketListen: true,
      toolExposure: "consolidatedTool",
      displayName: "Plug Database Advanced",
      technicalName: "plugDatabaseAdvanced",
      credentialName: "plugDatabaseAccountApi",
      iconBaseName: "plugDatabaseAdvancedV2",
      description: "Run Plug Database commands over REST or Socket.",
      version: [1, 2],
      defaultVersion: 2,
    }),
    subtitle: '={{$parameter["operation"]}}',
    icon: {
      light: "file:plugDatabaseAdvancedV2.svg",
      dark: "file:plugDatabaseAdvancedV2.dark.svg",
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const socketCommandExecutor = createSocketCommandExecutor(executeLegacySocketCommand);

    try {
      return await executePlugClientNode(this, {
        supportsSocket: true,
        credentialName: "plugDatabaseAccountApi",
        nodeDisplayName: "Plug Database Advanced",
        socketExecutor: socketCommandExecutor.execute,
        legacySocketExecutor: executeLegacySocketCommand,
        toolSocketEventPublisher: publishCustomSocketEventWithSocketIo,
        socketEventListener: waitForCustomSocketEventWithSocketIo,
      });
    } catch (error: unknown) {
      if (this.continueOnFail()) {
        return [
          [
            {
              json: {
                error:
                  error instanceof Error
                    ? error.message
                    : "Unknown Plug Database Advanced error",
              },
              pairedItem: {
                item: 0,
              },
            },
          ],
        ];
      }

      throw error;
    } finally {
      socketCommandExecutor.close();
    }
  }
}
