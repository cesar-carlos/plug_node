import { describe, expect, it, vi } from "vitest";

import { PluraAiAutomationsTrigger } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PluraAiAutomationsTrigger/PluraAiAutomationsTrigger.node";
import { requestPluraJson } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PluraAiAutomationsTrigger/pluraHelpers";

const createNodeReference = () => ({
  id: "node-id",
  name: "Plura Trigger",
  type: "pluraAiAutomationsTrigger",
  typeVersion: 1,
  position: [0, 0] as [number, number],
  parameters: {},
});

describe("PluraAiAutomationsTrigger", () => {
  const createHookContext = (input?: {
    readonly staticData?: Record<string, unknown>;
    readonly webhookUrl?: string;
    readonly journeyId?: string;
    readonly automationNodeId?: string;
    readonly httpResponse?: unknown;
  }) => {
    const staticData = input?.staticData ?? {};
    const httpRequest = vi.fn(async () => input?.httpResponse ?? { hook_id: "hook-1" });

    return {
      staticData,
      context: {
        getNode: createNodeReference,
        getNodeParameter: vi.fn((name: string) => {
          if (name === "journey_id") {
            return input?.journeyId ?? "journey-1";
          }

          if (name === "automation_node_id") {
            return input?.automationNodeId ?? "automation-node-1";
          }

          return "";
        }),
        getNodeWebhookUrl: vi.fn(() => input?.webhookUrl ?? "https://n8n.test/webhook"),
        getWorkflowStaticData: vi.fn(() => staticData),
        helpers: {
          httpRequest,
        },
      },
      httpRequest,
    };
  };

  it("normalizes account_id webhook payloads to accountId", async () => {
    const node = new PluraAiAutomationsTrigger();
    const context = {
      getBodyData: () => ({
        account_id: "acct-1",
        lead_id: "lead-1",
      }),
      helpers: {
        returnJsonArray: vi.fn((items) => items.map((json: unknown) => ({ json }))),
      },
    };

    const result = await node.webhook.call(context as never);

    expect(result.workflowData).toEqual([
      [
        {
          json: {
            account_id: "acct-1",
            accountId: "acct-1",
            lead_id: "lead-1",
          },
        },
      ],
    ]);
  });

  it("keeps accountId when the webhook already sends it", async () => {
    const node = new PluraAiAutomationsTrigger();
    const context = {
      getBodyData: () => ({
        account_id: "fallback-account",
        accountId: "primary-account",
      }),
      helpers: {
        returnJsonArray: vi.fn((items) => items.map((json: unknown) => ({ json }))),
      },
    };

    const result = await node.webhook.call(context as never);

    expect(result.workflowData?.[0]?.[0]?.json).toMatchObject({
      account_id: "fallback-account",
      accountId: "primary-account",
    });
  });

  it("subscribes the selected Plura automation node and stores hook metadata", async () => {
    const node = new PluraAiAutomationsTrigger();
    const { context, staticData, httpRequest } = createHookContext({
      webhookUrl: "https://n8n.test/webhook/plura",
      journeyId: "journey-123",
      automationNodeId: "node-456",
      httpResponse: {
        hook_id: "hook-789",
      },
    });

    const result = await node.webhookMethods.default.create.call(context as never);

    expect(result).toBe(true);
    expect(httpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "https://integrations.plura.ai/api/make-com/automation/subscribe",
        body: {
          journey_id: "journey-123",
          automation_node_id: "node-456",
          webhook_url: "https://n8n.test/webhook/plura",
          platform: "n8n",
        },
        json: true,
      }),
    );
    expect(staticData).toMatchObject({
      pluraWebhookUrl: "https://n8n.test/webhook/plura",
      pluraHookId: "hook-789",
      pluraJourneyId: "journey-123",
      pluraAutomationNodeId: "node-456",
    });
  });

  it("detects an existing Plura automation webhook only when static metadata matches", async () => {
    const node = new PluraAiAutomationsTrigger();
    const { context } = createHookContext({
      staticData: {
        pluraWebhookUrl: "https://n8n.test/webhook/plura",
        pluraHookId: "hook-1",
        pluraJourneyId: "journey-1",
        pluraAutomationNodeId: "automation-node-1",
      },
      webhookUrl: "https://n8n.test/webhook/plura",
    });

    await expect(
      node.webhookMethods.default.checkExists.call(context as never),
    ).resolves.toBe(true);
  });

  it("does not reuse a Plura automation webhook when URL or target node changed", async () => {
    const node = new PluraAiAutomationsTrigger();
    const changedUrlContext = createHookContext({
      staticData: {
        pluraWebhookUrl: "https://n8n.test/webhook/old",
        pluraHookId: "hook-1",
        pluraJourneyId: "journey-1",
        pluraAutomationNodeId: "automation-node-1",
      },
      webhookUrl: "https://n8n.test/webhook/new",
    }).context;
    const changedNodeContext = createHookContext({
      staticData: {
        pluraWebhookUrl: "https://n8n.test/webhook/plura",
        pluraHookId: "hook-1",
        pluraJourneyId: "journey-1",
        pluraAutomationNodeId: "old-node",
      },
      webhookUrl: "https://n8n.test/webhook/plura",
      automationNodeId: "new-node",
    }).context;

    await expect(
      node.webhookMethods.default.checkExists.call(changedUrlContext as never),
    ).resolves.toBe(false);
    await expect(
      node.webhookMethods.default.checkExists.call(changedNodeContext as never),
    ).resolves.toBe(false);
  });

  it("unsubscribes the stored Plura automation webhook URL", async () => {
    const node = new PluraAiAutomationsTrigger();
    const { context, httpRequest } = createHookContext({
      staticData: {
        pluraWebhookUrl: "https://n8n.test/webhook/plura",
      },
    });

    const result = await node.webhookMethods.default.delete.call(context as never);

    expect(result).toBe(true);
    expect(httpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        url: "https://integrations.plura.ai/api/make-com/automation/unsubscribe",
        body: {
          webhook_url: "https://n8n.test/webhook/plura",
        },
        json: true,
      }),
    );
  });

  it("skips unsubscribe when no webhook URL is available", async () => {
    const node = new PluraAiAutomationsTrigger();
    const { context, httpRequest } = createHookContext({
      webhookUrl: "",
    });

    const result = await node.webhookMethods.default.delete.call(context as never);

    expect(result).toBe(true);
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it("redacts Plura credentials from API errors", async () => {
    const context = {
      getNode: createNodeReference,
      helpers: {
        httpRequest: vi.fn(async () => {
          throw new Error(
            "Request failed for user@example.com with password secret-password",
          );
        }),
      },
    };

    let thrownError: unknown;
    try {
      await requestPluraJson(context as never, {
        method: "POST",
        url: "https://integrations.plura.ai/api/make-com/automation/options/workspaces",
        body: {
          user: "user@example.com",
          password: "secret-password",
        },
      });
    } catch (error: unknown) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(Error);
    const message = thrownError instanceof Error ? thrownError.message : "";
    expect(message).toContain("[redacted]");
    expect(message).not.toContain("user@example.com");
    expect(message).not.toContain("secret-password");
  });
});
