import { describe, expect, it } from "vitest";

import { PlugDatabase } from "../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/PlugDatabase.node";
import { PlugDatabaseAdvanced } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvanced/PlugDatabaseAdvanced.node";
import { PlugDatabaseAdvancedBarcode } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedBarcode/PlugDatabaseAdvancedBarcode.node";
import { PlugDatabaseAdvancedPdf } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedPdf/PlugDatabaseAdvancedPdf.node";
import { PlugDatabaseAdvancedSocketEventTrigger } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedSocketEventTrigger/PlugDatabaseAdvancedSocketEventTrigger.node";
import { PluraAiAutomationsTrigger } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PluraAiAutomationsTrigger/PluraAiAutomationsTrigger.node";

describe("consolidated Plug node descriptions", () => {
  const getToolsOperationProperties = (node: PlugDatabase | PlugDatabaseAdvanced) =>
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

  it("shows resource selection on the public consolidated node", () => {
    const node = new PlugDatabase();
    const resourceProperty = node.description.properties.find(
      (property) => property.name === "resource",
    );
    const operationProperties = node.description.properties.filter(
      (property) => property.name === "operation",
    );

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

  it("exposes only consolidated Plug nodes as tools across both packages", () => {
    expect(getToolExposedNodeNames([new PlugDatabase()])).toEqual(["plugDatabase"]);
    expect(
      getToolExposedNodeNames([
        new PlugDatabaseAdvanced(),
        new PlugDatabaseAdvancedPdf(),
        new PlugDatabaseAdvancedBarcode(),
        new PlugDatabaseAdvancedSocketEventTrigger(),
        new PluraAiAutomationsTrigger(),
      ]),
    ).toEqual(["plugDatabaseAdvanced"]);
  });

  it("keeps the consolidated Tools operation contract stable", () => {
    const publicNode = new PlugDatabase();
    const advancedNode = new PlugDatabaseAdvanced();
    const publicExpectedOperations = [
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
    ];
    const advancedExpectedOperations = [
      ...publicExpectedOperations,
      "waitForSocketEvent",
    ];

    expect(
      getToolsOperationProperties(publicNode).flatMap(
        (property) => property.options?.map((option) => option.value) ?? [],
      ),
    ).toEqual(publicExpectedOperations);
    expect(
      getToolsOperationProperties(advancedNode).flatMap(
        (property) => property.options?.map((option) => option.value) ?? [],
      ),
    ).toEqual(advancedExpectedOperations);
  });

  it("keeps the advanced PDF and barcode compatibility nodes hidden and out of tools", () => {
    expect(
      [new PlugDatabaseAdvancedPdf(), new PlugDatabaseAdvancedBarcode()].map((node) => ({
        name: node.description.name,
        hidden: node.description.hidden,
        usableAsTool: node.description.usableAsTool,
      })),
    ).toEqual([
      {
        name: "plugDatabaseAdvancedPdf",
        hidden: true,
        usableAsTool: undefined,
      },
      {
        name: "plugDatabaseAdvancedBarcode",
        hidden: true,
        usableAsTool: undefined,
      },
    ]);
  });

  it("exposes tools inside both consolidated Plug nodes", () => {
    const publicNode = new PlugDatabase();
    const advancedNode = new PlugDatabaseAdvanced();

    for (const node of [publicNode, advancedNode]) {
      const toolCategory = node.description.properties.find(
        (property) => property.name === "toolCategory",
      );
      const toolOperationOptions = getToolsOperationProperties(node).flatMap(
        (property) => property.options ?? [],
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
      expect(toolOperationOptions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: "htmlToPdf" }),
          expect.objectContaining({ value: "markdownToPdf" }),
          expect.objectContaining({ value: "resizeImage" }),
          expect.objectContaining({ value: "generateCode" }),
          expect.objectContaining({ value: "transformJson" }),
          expect.objectContaining({ value: "encryptText" }),
          expect.objectContaining({ value: "formatDate" }),
          expect.objectContaining({ value: "buildSqlRequest" }),
          expect.objectContaining({ value: "publishSocketEvent" }),
          expect.objectContaining({ name: "HTML to PDF" }),
          expect.objectContaining({ name: "Markdown to PDF" }),
          expect.objectContaining({ name: "Resize Image" }),
          expect.objectContaining({ name: "Generate Barcode" }),
          expect.objectContaining({ name: "Transform JSON" }),
          expect.objectContaining({ name: "Encrypt Text" }),
          expect.objectContaining({ name: "Format Date" }),
          expect.objectContaining({ name: "Build SQL Request" }),
          expect.objectContaining({ name: "Publish Socket Event" }),
        ]),
      );
    }

    const publicPublishChannel = publicNode.description.properties.find(
      (property) =>
        property.name === "publishChannel" &&
        property.displayOptions?.show?.resource?.[0] === "tools",
    );
    const advancedPublishChannel = advancedNode.description.properties.find(
      (property) =>
        property.name === "publishChannel" &&
        property.displayOptions?.show?.resource?.[0] === "tools",
    );

    expect(publicPublishChannel?.options).toEqual([
      expect.objectContaining({ value: "rest" }),
    ]);
    expect(advancedPublishChannel?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "rest" }),
        expect.objectContaining({ value: "socket" }),
      ]),
    );
    expect(
      publicNode.description.properties.some(
        (property) =>
          property.name === "listenTimeoutMs" &&
          property.displayOptions?.show?.operation?.[0] === "waitForSocketEvent",
      ),
    ).toBe(false);
    expect(advancedNode.description.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "eventName",
          displayOptions: expect.objectContaining({
            show: expect.objectContaining({
              resource: ["tools"],
              operation: ["waitForSocketEvent"],
            }),
          }),
        }),
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

  it("limits advanced socket controls to the SQL resource", () => {
    const node = new PlugDatabaseAdvanced();
    const channelProperties = node.description.properties.filter(
      (property) => property.name === "channel",
    );

    expect(channelProperties).not.toHaveLength(0);
    for (const property of channelProperties) {
      expect(property.displayOptions?.show?.resource).toEqual(["sql"]);
    }
  });

  it("uses the shared account credential across public, advanced, and trigger nodes", () => {
    const publicNode = new PlugDatabase();
    const advancedNode = new PlugDatabaseAdvanced();
    const trigger = new PlugDatabaseAdvancedSocketEventTrigger();

    expect(publicNode.description.credentials).toEqual([
      expect.objectContaining({ name: "plugDatabaseAccountApi", required: true }),
    ]);
    expect(advancedNode.description.credentials).toEqual([
      expect.objectContaining({ name: "plugDatabaseAccountApi", required: true }),
    ]);
    expect(trigger.description.credentials).toEqual([
      expect.objectContaining({ name: "plugDatabaseAccountApi", required: true }),
    ]);
  });

  it("exposes the advanced custom socket event trigger", () => {
    const trigger = new PlugDatabaseAdvancedSocketEventTrigger();

    expect(trigger.description.inputs).toEqual([]);
    expect(trigger.description.usableAsTool).toBeUndefined();
    expect(trigger.description.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "eventSource" }),
        expect.objectContaining({ name: "eventNames" }),
        expect.objectContaining({ name: "ackTimeoutMs" }),
        expect.objectContaining({ name: "reconnectOnDisconnect" }),
        expect.objectContaining({ name: "maxReconnectAttempts" }),
        expect.objectContaining({ name: "reconnectFailureWindowMs" }),
        expect.objectContaining({ name: "maxReconnectFailuresInWindow" }),
        expect.objectContaining({ name: "maxInflightEvents" }),
        expect.objectContaining({ name: "maxQueueSize" }),
        expect.objectContaining({ name: "overflowPolicy" }),
        expect.objectContaining({ name: "requirePayloadSignature" }),
        expect.objectContaining({ name: "requirePayloadSignatureFor" }),
        expect.objectContaining({ name: "deduplicateEvents" }),
        expect.objectContaining({ name: "deduplicationTtlMs" }),
        expect.objectContaining({ name: "binaryPropertyPrefix" }),
      ]),
    );
  });

  it("keeps advanced socket event listening inside the consolidated advanced tool menu", () => {
    const advancedNode = new PlugDatabaseAdvanced();
    const trigger = new PlugDatabaseAdvancedSocketEventTrigger();
    const waitForSocketEventOperation = getToolsOperationProperties(advancedNode)
      .flatMap((property) => property.options ?? [])
      .find((option) => option.value === "waitForSocketEvent");

    expect(waitForSocketEventOperation).toMatchObject({
      value: "waitForSocketEvent",
    });
    expect(trigger.description.usableAsTool).toBeUndefined();
  });

  it("exposes the Plura.ai automations trigger in the advanced package", () => {
    const trigger = new PluraAiAutomationsTrigger();

    expect(trigger.description).toMatchObject({
      displayName: "Plura.ai Automations Trigger",
      name: "pluraAiAutomationsTrigger",
      group: ["trigger"],
      inputs: [],
    });
    expect(trigger.description.usableAsTool).toBeUndefined();
    expect(trigger.description.outputs).toEqual(["main"]);
    expect(trigger.description.credentials).toEqual([
      expect.objectContaining({ name: "pluraAiAutomationsApi", required: true }),
    ]);
  });

  it("keeps legacy PDF and barcode tool nodes registered in the advanced package", () => {
    const nodes = [new PlugDatabaseAdvancedPdf(), new PlugDatabaseAdvancedBarcode()];

    for (const node of nodes) {
      expect(node.description.usableAsTool).toBeUndefined();
      expect(node.description.credentials).toBeUndefined();
      expect(node.description.properties).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "operation" }),
          expect.objectContaining({ name: "outputBinaryProperty" }),
          expect.objectContaining({ name: "includePlugToolsMetadata" }),
        ]),
      );
    }
  });

  it("keeps the public package focused on the verified REST-only node set", () => {
    expect([new PlugDatabase().description.name]).toEqual(["plugDatabase"]);
  });
});
