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

export class PlugDatabase implements INodeType {
  description: INodeTypeDescription = {
    ...buildPlugClientNodeDescription({
      supportsSocket: true,
      supportsSocketEventSocketPublish: true,
      supportsSocketEventSocketListen: true,
      toolExposure: "consolidatedTool",
      displayName: "Plug Database",
      technicalName: "plugDatabase",
      credentialName: "plugDatabaseAccountApi",
      iconBaseName: "plugDatabaseV2",
      description: "Run Plug Database commands over REST or Socket.",
      version: [1, 2],
      defaultVersion: 2,
    }),
    subtitle: '={{$parameter["operation"]}}',
    usableAsTool: true,
    icon: {
      light: "file:plugDatabaseV2.svg",
      dark: "file:plugDatabaseV2.dark.svg",
    },
    codex: {
      alias: ["Plug Database Advanced", "Plug SQL", "Plug Socket", "Plug Tools"],
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const socketCommandExecutor = createSocketCommandExecutor(executeLegacySocketCommand);

    try {
      return await executePlugClientNode(this, {
        supportsSocket: true,
        credentialName: "plugDatabaseAccountApi",
        nodeDisplayName: "Plug Database",
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
                  error instanceof Error ? error.message : "Unknown Plug Database error",
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
