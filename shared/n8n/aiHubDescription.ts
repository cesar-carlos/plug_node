import type { INodeProperties, INodeTypeDescription } from "n8n-workflow";
import { NodeConnectionTypes } from "n8n-workflow";

export interface AiHubDescriptionOptions {
  readonly displayName: string;
  readonly technicalName: string;
  readonly iconBaseName: string;
  readonly description: string;
}

const buildAiHubProperties = (): INodeProperties[] => [
  {
    displayName: "Identity",
    name: "identity",
    type: "string",
    typeOptions: {
      rows: 4,
    },
    default:
      "You are the operational ERP assistant. Your role is to query information and support decisions using real system data.",
    description: "Defines who the assistant is and how it should introduce itself.",
  },
  {
    displayName: "Scope",
    name: "scope",
    type: "string",
    typeOptions: {
      rows: 4,
    },
    default:
      "You can use only the tools connected to you. Do not access administration, credential, or user-management capabilities.",
    description: "Business scope and boundaries for the assistant.",
  },
  {
    displayName: "Max Tool Calls Per Turn",
    name: "maxToolCallsPerTurn",
    type: "number",
    default: 3,
    description: "Maximum number of tool calls allowed for each user message.",
  },
  {
    displayName: "Sensitive Data Rules",
    name: "sensitiveDataRules",
    type: "string",
    typeOptions: {
      rows: 4,
    },
    default:
      "Do not display full CPF or CNPJ values unless the tool already returns a masked format.\nDo not share one customer's data when answering about another customer.\nNever expose tokens, passwords, internal system IDs, or credential data.",
    description: "Rules for handling sensitive customer and credential data.",
  },
  {
    displayName: "Operational Limits",
    name: "operationalLimits",
    type: "string",
    typeOptions: {
      rows: 4,
    },
    default:
      "Do not run irreversible actions without explicit user confirmation.\nDo not modify registrations, titles, orders, or any ERP record.\nDo not repeat the same query in a loop when the previous result was empty.",
    description: "Operational guardrails enforced at the prompt level.",
  },
  {
    displayName: "Forbidden Capability Names JSON",
    name: "forbiddenCapabilityNamesJson",
    type: "json",
    default: "[]",
    description:
      "Capability names that must never be exposed to the agent, such as administration tools.",
  },
];

export const buildAiHubNodeDescription = (
  options: AiHubDescriptionOptions,
): INodeTypeDescription => ({
  displayName: options.displayName,
  name: options.technicalName,
  icon: `file:${options.iconBaseName}.svg`,
  group: ["transform"],
  version: 1,
  subtitle: "AI Hub",
  description: options.description,
  defaults: {
    name: options.displayName,
  },
  inputs: [NodeConnectionTypes.Main],
  outputs: [NodeConnectionTypes.Main],
  properties: buildAiHubProperties(),
});
