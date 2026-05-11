import type {
  IHookFunctions,
  ILoadOptionsFunctions,
  INodeListSearchItems,
  INodePropertyOptions,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from "n8n-workflow";
import { NodeConnectionTypes, NodeOperationError } from "n8n-workflow";

import {
  getIntegrationsBaseUrl,
  getPluraCredentials,
  requestPluraJson,
  type PluraOptionsResponse,
} from "./pluraHelpers";

const credentialName = "pluraAiAutomationsApi";
const webhookName = "default";
const webhookPath = "plura-ai-automations";

const toNodeOptions = (
  response: PluraOptionsResponse,
): INodePropertyOptions[] | INodeListSearchItems[] =>
  (response.items ?? []).map((item) => ({
    name: item.label,
    value: item.value,
  }));

export class PluraAiAutomationsTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Plura.ai Automations Trigger",
    name: "pluraAiAutomationsTrigger",
    icon: "file:plura.svg",
    group: ["trigger"],
    version: 1,
    subtitle: '={{$parameter["automation_node_id"]}}',
    description:
      "Triggers when a Plura.ai automation node is executed. Plura.ai helps teams build, deploy, and manage AI agents for calls, chat, and workflows.",
    defaults: {
      name: "Plura.ai Automations Trigger",
    },
    usableAsTool: true,
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: credentialName,
        required: true,
      },
    ],
    webhooks: [
      {
        name: webhookName,
        httpMethod: "POST",
        responseMode: "onReceived",
        path: webhookPath,
      },
    ],
    properties: [
      {
        displayName: "Workspace Name or ID",
        name: "workspace_id",
        type: "options",
        required: true,
        default: "",
        typeOptions: {
          loadOptionsMethod: "getWorkspaces",
        },
        description:
          'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
      },
      {
        displayName: "Journey Name or ID",
        name: "journey_id",
        type: "options",
        required: true,
        default: "",
        typeOptions: {
          loadOptionsMethod: "getJourneys",
          loadOptionsDependsOn: ["workspace_id"],
        },
        description:
          'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
      },
      {
        displayName: "Automation Node Name or ID",
        name: "automation_node_id",
        type: "options",
        required: true,
        default: "",
        typeOptions: {
          loadOptionsMethod: "getAutomationNodes",
          loadOptionsDependsOn: ["journey_id"],
        },
        description:
          'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
      },
    ],
  };

  methods = {
    loadOptions: {
      async getWorkspaces(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const credentials = await getPluraCredentials(this);
        const response = await requestPluraJson<PluraOptionsResponse>(this, {
          method: "POST",
          url: `${getIntegrationsBaseUrl()}/make-com/automation/options/workspaces`,
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            user: credentials.email,
            password: credentials.password,
          },
        });

        return toNodeOptions(response) as INodePropertyOptions[];
      },

      async getJourneys(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const workspaceId = this.getCurrentNodeParameter("workspace_id") as string;
        const credentials = await getPluraCredentials(this);
        const response = await requestPluraJson<PluraOptionsResponse>(this, {
          method: "POST",
          url: `${getIntegrationsBaseUrl()}/make-com/automation/options/journeys`,
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            user: credentials.email,
            password: credentials.password,
            workspace_id: workspaceId,
          },
        });

        return toNodeOptions(response) as INodePropertyOptions[];
      },

      async getAutomationNodes(
        this: ILoadOptionsFunctions,
      ): Promise<INodePropertyOptions[]> {
        const journeyId = this.getCurrentNodeParameter("journey_id") as string;
        const credentials = await getPluraCredentials(this);
        const response = await requestPluraJson<PluraOptionsResponse>(this, {
          method: "POST",
          url: `${getIntegrationsBaseUrl()}/make-com/automation/options/nodes`,
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            user: credentials.email,
            password: credentials.password,
            journey_id: journeyId,
          },
        });

        return toNodeOptions(response) as INodePropertyOptions[];
      },
    },
  };

  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const staticData = this.getWorkflowStaticData("node") as Record<string, unknown>;
        const storedHookId = staticData.pluraHookId;
        const storedWebhookUrl = staticData.pluraWebhookUrl;
        const webhookUrl = this.getNodeWebhookUrl(webhookName);

        if (!webhookUrl || (!storedHookId && !storedWebhookUrl)) {
          return false;
        }

        if (storedWebhookUrl !== webhookUrl) {
          return false;
        }

        const journeyId = this.getNodeParameter("journey_id") as string;
        const automationNodeId = this.getNodeParameter("automation_node_id") as string;

        return (
          staticData.pluraJourneyId === journeyId &&
          staticData.pluraAutomationNodeId === automationNodeId
        );
      },

      async create(this: IHookFunctions): Promise<boolean> {
        const journeyId = this.getNodeParameter("journey_id") as string;
        const automationNodeId = this.getNodeParameter("automation_node_id") as string;
        const webhookUrl = this.getNodeWebhookUrl(webhookName);

        if (!webhookUrl) {
          throw new NodeOperationError(this.getNode(), "Failed to determine webhook URL");
        }

        const response = await requestPluraJson<{ readonly hook_id?: string }>(this, {
          method: "POST",
          url: `${getIntegrationsBaseUrl()}/make-com/automation/subscribe`,
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            journey_id: journeyId,
            automation_node_id: automationNodeId,
            webhook_url: webhookUrl,
            platform: "n8n",
          },
        });

        const staticData = this.getWorkflowStaticData("node") as Record<string, unknown>;
        staticData.pluraWebhookUrl = webhookUrl;
        staticData.pluraHookId = response.hook_id;
        staticData.pluraJourneyId = journeyId;
        staticData.pluraAutomationNodeId = automationNodeId;

        return true;
      },

      async delete(this: IHookFunctions): Promise<boolean> {
        const staticData = this.getWorkflowStaticData("node") as Record<string, unknown>;
        const storedWebhookUrl =
          typeof staticData.pluraWebhookUrl === "string"
            ? staticData.pluraWebhookUrl
            : "";
        const webhookUrl = storedWebhookUrl || this.getNodeWebhookUrl(webhookName);

        if (!webhookUrl) {
          return true;
        }

        await requestPluraJson(this, {
          method: "DELETE",
          url: `${getIntegrationsBaseUrl()}/make-com/automation/unsubscribe`,
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            webhook_url: webhookUrl,
          },
        });

        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const body = this.getBodyData() as Record<
      string,
      string | number | boolean | null | undefined
    >;
    const accountId =
      body.accountId !== undefined ? body.accountId : (body.account_id ?? null);

    return {
      workflowData: [
        this.helpers.returnJsonArray([
          {
            ...body,
            accountId,
          },
        ]),
      ],
    };
  }
}
