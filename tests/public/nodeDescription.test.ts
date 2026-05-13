import { describe, expect, it } from "vitest";

import { PlugDatabase } from "../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/PlugDatabase.node";
import { PlugDatabaseClientAccess } from "../../packages/n8n-nodes-plug-database/nodes/PlugDatabaseClientAccess/PlugDatabaseClientAccess.node";
import { PlugDatabaseUserAccess } from "../../packages/n8n-nodes-plug-database/nodes/PlugDatabaseUserAccess/PlugDatabaseUserAccess.node";
import { PlugDatabaseAdvanced } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvanced/PlugDatabaseAdvanced.node";
import { PlugDatabaseAdvancedBarcode } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedBarcode/PlugDatabaseAdvancedBarcode.node";
import { PlugDatabaseAdvancedClientAccess } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedClientAccess/PlugDatabaseAdvancedClientAccess.node";
import { PlugDatabaseAdvancedPdf } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedPdf/PlugDatabaseAdvancedPdf.node";
import { PlugDatabaseAdvancedSocketEvent } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedSocketEvent/PlugDatabaseAdvancedSocketEvent.node";
import { PlugDatabaseAdvancedSocketEventTrigger } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedSocketEventTrigger/PlugDatabaseAdvancedSocketEventTrigger.node";
import { PlugDatabaseAdvancedUserAccess } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedUserAccess/PlugDatabaseAdvancedUserAccess.node";
import { PluraAiAutomationsTrigger } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PluraAiAutomationsTrigger/PluraAiAutomationsTrigger.node";

describe("consolidated Plug node descriptions", () => {
  const getToolsOperationProperties = (node: PlugDatabase | PlugDatabaseAdvanced) =>
    node.description.properties.filter(
      (property) =>
        property.name === "operation" &&
        property.displayOptions?.show?.resource?.[0] === "tools",
    );

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
    expect(
      operationProperties.map((property) => property.displayOptions?.show?.resource),
    ).toEqual([
      ["sql"],
      ["clientAccess"],
      ["userAccess"],
      ["tools"],
      ["tools"],
      ["tools"],
      ["tools"],
      ["tools"],
      ["tools"],
      ["tools"],
      ["tools"],
    ]);
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

  it("keeps legacy advanced tool nodes hidden with stable technical names", () => {
    expect(
      [
        new PlugDatabaseAdvancedPdf(),
        new PlugDatabaseAdvancedBarcode(),
        new PlugDatabaseAdvancedSocketEvent(),
      ].map((node) => ({
        name: node.description.name,
        hidden: node.description.hidden,
        usableAsTool: node.description.usableAsTool,
      })),
    ).toEqual([
      {
        name: "plugDatabaseAdvancedPdf",
        hidden: true,
        usableAsTool: true,
      },
      {
        name: "plugDatabaseAdvancedBarcode",
        hidden: true,
        usableAsTool: true,
      },
      {
        name: "plugDatabaseAdvancedSocketEvent",
        hidden: true,
        usableAsTool: true,
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
      expect(node.description.properties).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "html",
            displayOptions: expect.objectContaining({
              show: expect.objectContaining({
                resource: ["tools"],
                operation: ["htmlToPdf"],
              }),
            }),
          }),
          expect.objectContaining({
            name: "barcodeType",
            displayOptions: expect.objectContaining({
              show: expect.objectContaining({
                resource: ["tools"],
                operation: ["generateCode"],
              }),
            }),
          }),
          expect.objectContaining({
            name: "jsonataExpression",
            displayOptions: expect.objectContaining({
              show: expect.objectContaining({
                resource: ["tools"],
                operation: ["transformJson"],
              }),
            }),
          }),
          expect.objectContaining({
            name: "eventName",
            displayOptions: expect.objectContaining({
              show: expect.objectContaining({
                resource: ["tools"],
                operation: ["publishSocketEvent"],
              }),
            }),
          }),
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

  it("hides legacy access nodes from the creator while keeping them registered", () => {
    expect(new PlugDatabaseClientAccess().description.hidden).toBe(true);
    expect(new PlugDatabaseUserAccess().description.hidden).toBe(true);
    expect(new PlugDatabaseAdvancedClientAccess().description.hidden).toBe(true);
    expect(new PlugDatabaseAdvancedUserAccess().description.hidden).toBe(true);
    expect(new PlugDatabaseAdvancedPdf().description.hidden).toBe(true);
    expect(new PlugDatabaseAdvancedBarcode().description.hidden).toBe(true);
    expect(new PlugDatabaseAdvancedSocketEvent().description.hidden).toBe(true);
  });

  it("exposes advanced custom socket event publish and trigger nodes", () => {
    const publisher = new PlugDatabaseAdvancedSocketEvent();
    const trigger = new PlugDatabaseAdvancedSocketEventTrigger();

    expect(publisher.description.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "eventName" }),
        expect.objectContaining({ name: "payloadJson" }),
        expect.objectContaining({ name: "publishChannel" }),
        expect.objectContaining({ name: "attachments" }),
        expect.objectContaining({ name: "idempotencyKey" }),
        expect.objectContaining({ name: "socketAckTimeoutMs" }),
      ]),
    );
    expect(publisher.description.credentials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "plugDatabaseAdvancedApi", required: true }),
      ]),
    );
    expect(trigger.description.inputs).toEqual([]);
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

  it("exposes the Plura.ai automations trigger in the advanced package", () => {
    const trigger = new PluraAiAutomationsTrigger();

    expect(trigger.description).toMatchObject({
      displayName: "Plura.ai Automations Trigger",
      name: "pluraAiAutomationsTrigger",
      group: ["trigger"],
      inputs: [],
    });
    expect(trigger.description.outputs).toEqual(["main"]);
    expect(trigger.description.credentials).toEqual([
      expect.objectContaining({ name: "pluraAiAutomationsApi", required: true }),
    ]);
    expect(trigger.description.webhooks).toEqual([
      expect.objectContaining({
        name: "default",
        httpMethod: "POST",
        responseMode: "onReceived",
        path: "plura-ai-automations",
      }),
    ]);
    expect(trigger.description.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "workspace_id" }),
        expect.objectContaining({ name: "journey_id" }),
        expect.objectContaining({ name: "automation_node_id" }),
      ]),
    );
  });

  it("keeps legacy PDF and barcode tool nodes registered in the advanced package", () => {
    const nodes = [new PlugDatabaseAdvancedPdf(), new PlugDatabaseAdvancedBarcode()];

    for (const node of nodes) {
      expect(node.description.usableAsTool).toBe(true);
      expect(node.description.credentials).toBeUndefined();
      expect(node.description.properties).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "operation" }),
          expect.objectContaining({ name: "outputBinaryProperty" }),
          expect.objectContaining({ name: "includePlugToolsMetadata" }),
        ]),
      );
    }

    expect(new PlugDatabaseAdvancedPdf().description.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "html" }),
        expect.objectContaining({ name: "css" }),
        expect.objectContaining({ name: "browserOptions" }),
        expect.objectContaining({ name: "pdfOptions" }),
      ]),
    );
    expect(new PlugDatabaseAdvancedBarcode().description.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "text" }),
        expect.objectContaining({ name: "barcodeType" }),
        expect.objectContaining({ name: "includeBase64Json" }),
        expect.objectContaining({ name: "advancedOptionsJson" }),
      ]),
    );
    expect(new PlugDatabaseAdvancedPdf().description.name).toBe(
      "plugDatabaseAdvancedPdf",
    );
  });

  it("keeps the public package focused on the verified REST-only node set", () => {
    const publicNodeNames = [
      new PlugDatabase().description.name,
      new PlugDatabaseClientAccess().description.name,
      new PlugDatabaseUserAccess().description.name,
    ];

    expect(publicNodeNames).toEqual([
      "plugDatabase",
      "plugDatabaseClientAccess",
      "plugDatabaseUserAccess",
    ]);
  });
});
