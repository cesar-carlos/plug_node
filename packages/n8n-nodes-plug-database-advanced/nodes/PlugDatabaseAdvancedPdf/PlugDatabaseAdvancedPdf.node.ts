import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";

import { buildPlugToolsPdfNodeDescription } from "../../generated/shared/n8n/plugToolsDescription";
import { executePlugToolsPdfNode } from "../../generated/shared/n8n/plugToolsExecution";

export class PlugDatabaseAdvancedPdf implements INodeType {
  description: INodeTypeDescription = {
    ...buildPlugToolsPdfNodeDescription({
      displayName: "Plug Database Advanced PDF",
      technicalName: "plugDatabaseAdvancedPdf",
      iconBaseName: "plugToolsPdf",
      description: "Render HTML to PDF binary files for advanced Plug workflows.",
      toolExposure: "workflowOnly",
    }),
    hidden: true,
    subtitle: '={{$parameter["operation"]}}',
    icon: {
      light: "file:plugToolsPdf.svg",
      dark: "file:plugToolsPdf.dark.svg",
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    try {
      return await executePlugToolsPdfNode(this, {
        nodeDisplayName: "Plug Database Advanced PDF",
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
                    : "Unknown Plug Database Advanced PDF error",
              },
              pairedItem: {
                item: 0,
              },
            },
          ],
        ];
      }

      throw error;
    }
  }
}
