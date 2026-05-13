import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";

import { buildPlugToolsBarcodeNodeDescription } from "../../generated/shared/n8n/plugToolsDescription";
import { executePlugToolsBarcodeNode } from "../../generated/shared/n8n/plugToolsExecution";

export class PlugDatabaseAdvancedBarcode implements INodeType {
  description: INodeTypeDescription = {
    ...buildPlugToolsBarcodeNodeDescription({
      displayName: "Plug Database Advanced Barcode",
      technicalName: "plugDatabaseAdvancedBarcode",
      iconBaseName: "plugToolsBarcode",
      description:
        "Generate QR codes and barcodes as binary files for advanced Plug workflows.",
      toolExposure: "workflowOnly",
    }),
    hidden: true,
    subtitle: '={{$parameter["operation"]}}',
    usableAsTool: false as unknown as true,
    icon: {
      light: "file:plugToolsBarcode.svg",
      dark: "file:plugToolsBarcode.dark.svg",
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    try {
      return await executePlugToolsBarcodeNode(this, {
        nodeDisplayName: "Plug Database Advanced Barcode",
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
                    : "Unknown Plug Database Advanced Barcode error",
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
