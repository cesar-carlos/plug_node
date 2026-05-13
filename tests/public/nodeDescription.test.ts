import { describe, expect, it } from "vitest";

import { PlugDatabase } from "../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/PlugDatabase.node";
import { PlugDatabaseSocketEventTrigger } from "../../packages/n8n-nodes-plug-database/nodes/PlugDatabaseSocketEventTrigger/PlugDatabaseSocketEventTrigger.node";
import { PluraAiAutomationsTrigger } from "../../packages/n8n-nodes-plug-database/nodes/PluraAiAutomationsTrigger/PluraAiAutomationsTrigger.node";

describe("consolidated Plug node descriptions", () => {
  const getToolsOperationProperties = (node: PlugDatabase) =>
    node.description.properties.filter(
      (property) =>
        property.name === "operation" &&
        property.displayOptions?.show?.resource?.[0] === "tools",
    );

  const getToolExposedNodeNames = (
    nodes: Array<{
      readonly description: {
        readonly name: string;
        readonly usableAsTool?: unknown;
      };
    }>,
  ) =>
    nodes
      .filter((node) => node.description.usableAsTool === true)
      .map((node) => node.description.name);

  it("shows the unified Plug Database resource selection", () => {
    const node = new PlugDatabase();
    const resourceProperty = node.description.properties.find(
      (property) => property.name === "resource",
    );
    const operationProperties = node.description.properties.filter(
      (property) => property.name === "operation",
    );

    expect(node.description).toMatchObject({
      displayName: "Plug Database",
      name: "plugDatabase",
      version: [1, 2],
      defaultVersion: 2,
      usableAsTool: true,
      codex: {
        alias: expect.arrayContaining(["Plug Database Advanced", "Plug Socket"]),
      },
    });
    expect(resourceProperty).toMatchObject({
      name: "resource",
      default: "sql",
    });
    expect(resourceProperty?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "sql" }),
        expect.objectContaining({ value: "clientAccess" }),
        expect.objectContaining({ value: "userAccess" }),
        expect.objectContaining({ value: "tools" }),
      ]),
    );
    expect(operationProperties).toHaveLength(11);
  });

  it("exposes only Plug Database as a tool", () => {
    expect(
      getToolExposedNodeNames([
        new PlugDatabase(),
        new PlugDatabaseSocketEventTrigger(),
        new PluraAiAutomationsTrigger(),
      ]),
    ).toEqual(["plugDatabase"]);
  });

  it("keeps the consolidated Tools operation contract stable", () => {
    const node = new PlugDatabase();
    const expectedOperations = [
      "htmlToPdf",
      "markdownToPdf",
      "textToPdf",
      "mergePdfs",
      "splitPdf",
      "extractPdfText",
      "resizeImage",
      "convertImage",
      "compressImage",
      "addImageWatermark",
      "createThumbnail",
      "generateCode",
      "readBarcode",
      "validateCpfCnpj",
      "formatCpfCnpj",
      "generateUuid",
      "transformJson",
      "csvToJson",
      "jsonToCsv",
      "normalizeText",
      "extractRegexFields",
      "validateJsonSchema",
      "generateHash",
      "hmacSign",
      "base64",
      "jwtDecode",
      "encryptText",
      "decryptText",
      "formatDate",
      "parseDate",
      "addBusinessDays",
      "formatCurrency",
      "numberToWords",
      "buildSocketEventPayload",
      "validateClientToken",
      "validateAgentContext",
      "buildSqlRequest",
      "parseSqlRows",
      "generateAccessRequestSummary",
      "publishSocketEvent",
      "waitForSocketEvent",
    ];

    expect(
      getToolsOperationProperties(node).flatMap(
        (property) => property.options?.map((option) => option.value) ?? [],
      ),
    ).toEqual(expectedOperations);
  });

  it("exposes tools, Socket publish, and one-shot Socket Event waiting in Plug Database", () => {
    const node = new PlugDatabase();
    const toolCategory = node.description.properties.find(
      (property) => property.name === "toolCategory",
    );
    const publishChannel = node.description.properties.find(
      (property) =>
        property.name === "publishChannel" &&
        property.displayOptions?.show?.resource?.[0] === "tools",
    );

    expect(toolCategory?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "documents" }),
        expect.objectContaining({ value: "image" }),
        expect.objectContaining({ value: "identity" }),
        expect.objectContaining({ value: "data" }),
        expect.objectContaining({ value: "security" }),
        expect.objectContaining({ value: "dateValue" }),
        expect.objectContaining({ value: "plugSpecific" }),
        expect.objectContaining({ value: "socket" }),
      ]),
    );
    expect(publishChannel?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "rest" }),
        expect.objectContaining({ value: "socket" }),
      ]),
    );
    expect(node.description.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "listenTimeoutMs",
          typeOptions: expect.objectContaining({
            minValue: 1,
            maxValue: 300000,
          }),
          displayOptions: expect.objectContaining({
            show: expect.objectContaining({
              resource: ["tools"],
              operation: ["waitForSocketEvent"],
            }),
          }),
        }),
        expect.objectContaining({
          name: "requirePayloadSignature",
          displayOptions: expect.objectContaining({
            show: expect.objectContaining({
              resource: ["tools"],
              operation: ["waitForSocketEvent"],
            }),
          }),
        }),
      ]),
    );
  });

  it("limits Socket SQL controls to the SQL resource", () => {
    const node = new PlugDatabase();
    const channelProperties = node.description.properties.filter(
      (property) => property.name === "channel",
    );

    expect(channelProperties).not.toHaveLength(0);
    for (const property of channelProperties) {
      expect(property.displayOptions?.show?.resource).toEqual(["sql"]);
    }
  });

  it("uses the shared account credential across Plug Database and the Socket Event trigger", () => {
    const node = new PlugDatabase();
    const trigger = new PlugDatabaseSocketEventTrigger();

    expect(node.description.credentials).toEqual([
      expect.objectContaining({ name: "plugDatabaseAccountApi", required: true }),
    ]);
    expect(trigger.description.credentials).toEqual([
      expect.objectContaining({ name: "plugDatabaseAccountApi", required: true }),
    ]);
  });

  it("exposes the renamed custom Socket Event trigger", () => {
    const trigger = new PlugDatabaseSocketEventTrigger();

    expect(trigger.description).toMatchObject({
      displayName: "Plug Database Socket Event Trigger",
      name: "plugDatabaseSocketEventTrigger",
      icon: {
        light: "file:plugDatabaseV2.svg",
        dark: "file:plugDatabaseV2.dark.svg",
      },
      inputs: [],
      eventTriggerDescription:
        "Emits one item when a subscribed Plug Database socket event is received.",
      activationMessage: "Listening for Plug Database socket events.",
      codex: {
        alias: expect.arrayContaining(["Plug Database Advanced Trigger", "Socket Event"]),
      },
    });
    expect(trigger.description.usableAsTool).toBeUndefined();
    expect(trigger.description.triggerPanel).toMatchObject({
      header: "Listen for Plug Database socket events",
    });
    expect(trigger.description.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "eventSource" }),
        expect.objectContaining({ name: "eventNames" }),
        expect.objectContaining({ name: "ackTimeoutMs" }),
        expect.objectContaining({ name: "reconnectOnDisconnect" }),
        expect.objectContaining({ name: "maxReconnectAttempts" }),
        expect.objectContaining({ name: "maxInflightEvents" }),
        expect.objectContaining({ name: "maxQueueSize" }),
        expect.objectContaining({ name: "overflowPolicy" }),
        expect.objectContaining({ name: "requirePayloadSignature" }),
        expect.objectContaining({ name: "deduplicateEvents" }),
        expect.objectContaining({ name: "binaryPropertyPrefix" }),
      ]),
    );
  });

  it("exposes the Plura.ai automations trigger in the unified package with its compatible internal name", () => {
    const trigger = new PluraAiAutomationsTrigger();

    expect(trigger.description).toMatchObject({
      displayName: "Plug Database Plura.ai Automations Trigger",
      name: "pluraAiAutomationsTrigger",
      icon: {
        light: "file:../PlugDatabase/plugDatabaseV2.svg",
        dark: "file:../PlugDatabase/plugDatabaseV2.dark.svg",
      },
      group: ["trigger"],
      inputs: [],
      eventTriggerDescription:
        "Emits one item when Plura.ai calls the configured automation webhook.",
      activationMessage: "Webhook registered with Plura.ai automations.",
      codex: {
        alias: expect.arrayContaining(["Plura", "Plug Database Plura"]),
      },
    });
    expect(trigger.description.usableAsTool).toBeUndefined();
    expect(trigger.description.triggerPanel).toMatchObject({
      header: "Receive Plura.ai automation webhooks",
    });
    expect(trigger.description.outputs).toEqual(["main"]);
    expect(trigger.description.credentials).toEqual([
      expect.objectContaining({ name: "pluraAiAutomationsApi", required: true }),
    ]);
  });

  it("keeps visible node names grouped under Plug Database without Advanced", () => {
    const visibleNames = [
      new PlugDatabase().description.displayName,
      new PlugDatabaseSocketEventTrigger().description.displayName,
      new PluraAiAutomationsTrigger().description.displayName,
    ];

    expect(visibleNames).toEqual([
      "Plug Database",
      "Plug Database Socket Event Trigger",
      "Plug Database Plura.ai Automations Trigger",
    ]);
    expect(visibleNames.every((name) => name.startsWith("Plug Database"))).toBe(true);
    expect(visibleNames).not.toEqual(
      expect.arrayContaining([expect.stringContaining("Advanced")]),
    );
  });
});
