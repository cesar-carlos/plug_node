import type { INodeTypeDescription } from "n8n-workflow";

export const plugToolExposureConsolidated = "consolidatedTool" as const;
export const plugToolExposureWorkflowOnly = "workflowOnly" as const;

export type PlugToolExposure =
  | typeof plugToolExposureConsolidated
  | typeof plugToolExposureWorkflowOnly;

export const applyToolExposure = (
  description: INodeTypeDescription,
  exposure: PlugToolExposure = plugToolExposureConsolidated,
): INodeTypeDescription => ({
  ...description,
  usableAsTool:
    exposure === plugToolExposureConsolidated ? true : undefined,
});

export const asConsolidatedToolNodeDescription = (
  description: INodeTypeDescription,
): INodeTypeDescription =>
  applyToolExposure(description, plugToolExposureConsolidated);

export const asWorkflowOnlyNodeDescription = (
  description: INodeTypeDescription,
): INodeTypeDescription =>
  applyToolExposure(description, plugToolExposureWorkflowOnly);
