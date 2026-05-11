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

describe("consolidated Plug node descriptions", () => {
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
      ]),
    );
    expect(operationProperties).toHaveLength(3);
    expect(
      operationProperties.map((property) => property.displayOptions?.show?.resource),
    ).toEqual([["sql"], ["clientAccess"], ["userAccess"]]);
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
  });

  it("exposes advanced custom socket event publish and trigger nodes", () => {
    const publisher = new PlugDatabaseAdvancedSocketEvent();
    const trigger = new PlugDatabaseAdvancedSocketEventTrigger();

    expect(publisher.description.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "eventName" }),
        expect.objectContaining({ name: "payloadJson" }),
        expect.objectContaining({ name: "idempotencyKey" }),
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
        expect.objectContaining({ name: "eventNames" }),
        expect.objectContaining({ name: "ackTimeoutMs" }),
        expect.objectContaining({ name: "reconnectOnDisconnect" }),
        expect.objectContaining({ name: "maxReconnectAttempts" }),
        expect.objectContaining({ name: "binaryPropertyPrefix" }),
      ]),
    );
  });

  it("exposes PDF and barcode tool nodes in the advanced package", () => {
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
