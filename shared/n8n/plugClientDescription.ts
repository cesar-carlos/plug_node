import type { INodeProperties, INodeTypeDescription } from "n8n-workflow";
import { NodeConnectionTypes } from "n8n-workflow";

import { buildPlugClientAccessProperties } from "./plugClientAccessDescription";
import { buildPlugSqlProperties } from "./plugSqlDescription";
import { buildPlugToolsProperties } from "./plugToolsDescription";
import {
  applyToolExposure,
  plugToolExposureConsolidated,
  type PlugToolExposure,
} from "./toolExposure";
import { buildPlugUserAccessProperties } from "./plugUserAccessDescription";

const addResourceDisplayOption = (
  property: INodeProperties,
  resource: string,
): INodeProperties => ({
  ...property,
  displayOptions: {
    ...property.displayOptions,
    show: {
      ...(property.displayOptions?.show ?? {}),
      resource: [resource],
    },
  },
});

export interface PlugNodeDescriptionOptions {
  readonly supportsSocket: boolean;
  readonly supportsSocketEventSocketPublish?: boolean;
  readonly supportsSocketEventSocketListen?: boolean;
  readonly toolExposure?: PlugToolExposure;
  readonly displayName: string;
  readonly technicalName: string;
  readonly credentialName: string;
  readonly iconBaseName: string;
  readonly description: string;
  readonly version?: number | number[];
  readonly defaultVersion?: number;
}

export const buildPlugClientNodeDescription = (
  options: PlugNodeDescriptionOptions,
): INodeTypeDescription =>
  applyToolExposure(
    {
      displayName: options.displayName,
      name: options.technicalName,
      icon: `file:${options.iconBaseName}.svg`,
      group: ["transform"],
      version: options.version ?? 1,
      ...(options.defaultVersion !== undefined
        ? { defaultVersion: options.defaultVersion }
        : {}),
      subtitle: '={{$parameter["operation"]}}',
      description: options.description,
      defaults: {
        name: options.displayName,
      },
      inputs: [NodeConnectionTypes.Main],
      outputs: [NodeConnectionTypes.Main],
      credentials: [
        {
          name: options.credentialName,
          required: true,
        },
      ],
      properties: [
        {
          displayName: "Resource",
          name: "resource",
          type: "options",
          default: "sql",
          description: "Choose which Plug capability group this node should expose.",
          options: [
            {
              name: "SQL",
              value: "sql",
              description: "Run SQL and JSON-RPC commands against a Plug agent.",
            },
            {
              name: "Client Access",
              value: "clientAccess",
              description: "Manage client-to-agent access and client tokens.",
            },
            {
              name: "User Access",
              value: "userAccess",
              description: "Review catalog, approvals, and owned agent access.",
            },
            {
              name: "Tools",
              value: "tools",
              description: "Generate PDFs, barcodes, and publish Plug socket events.",
            },
          ],
        },
        ...buildPlugSqlProperties(options.supportsSocket).map((property) =>
          addResourceDisplayOption(property, "sql"),
        ),
        ...buildPlugClientAccessProperties().map((property) =>
          addResourceDisplayOption(property, "clientAccess"),
        ),
        ...buildPlugUserAccessProperties().map((property) =>
          addResourceDisplayOption(property, "userAccess"),
        ),
        ...buildPlugToolsProperties({
          supportsSocketPublish:
            options.supportsSocketEventSocketPublish ?? options.supportsSocket,
          supportsSocketListen: options.supportsSocketEventSocketListen ?? false,
        }).map((property) => addResourceDisplayOption(property, "tools")),
      ],
    },
    options.toolExposure ?? plugToolExposureConsolidated,
  );
