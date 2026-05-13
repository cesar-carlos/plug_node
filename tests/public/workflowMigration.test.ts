import { describe, expect, it } from "vitest";

import { migrateWorkflowDocument } from "../../scripts/migrate-advanced-workflows.mjs";

describe("advanced workflow migration", () => {
  it("renames legacy Advanced workflow nodes to the unified node surface", () => {
    const workflow = {
      nodes: [
        {
          name: "Advanced SQL",
          type: "n8n-nodes-plug-database-advanced.plugDatabaseAdvanced",
          parameters: {
            resource: "sql",
            operation: "executeSql",
          },
        },
        {
          name: "Socket Trigger",
          type: "n8n-nodes-plug-database-advanced.plugDatabaseAdvancedSocketEventTrigger",
          parameters: {
            eventSource: "customEvents",
          },
        },
      ],
    };

    const { document, changes } = migrateWorkflowDocument(workflow);

    expect(changes).toEqual([
      expect.objectContaining({
        name: "Advanced SQL",
        oldType: "n8n-nodes-plug-database-advanced.plugDatabaseAdvanced",
        newType: "n8n-nodes-plug-database.plugDatabase",
      }),
      expect.objectContaining({
        name: "Socket Trigger",
        oldType:
          "n8n-nodes-plug-database-advanced.plugDatabaseAdvancedSocketEventTrigger",
        newType: "n8n-nodes-plug-database.plugDatabaseSocketEventTrigger",
      }),
    ]);
    expect(document.nodes[0].type).toBe("n8n-nodes-plug-database.plugDatabase");
    expect(document.nodes[1].type).toBe(
      "n8n-nodes-plug-database.plugDatabaseSocketEventTrigger",
    );
  });

  it("moves legacy hidden PDF and barcode nodes into Plug Database tools", () => {
    const workflow = {
      nodes: [
        {
          name: "PDF",
          type: "plugDatabaseAdvancedPdf",
          parameters: {
            html: "<h1>Test</h1>",
          },
        },
        {
          name: "Barcode",
          type: "plugDatabaseAdvancedBarcode",
          parameters: {
            operation: "readBarcode",
            binaryPropertyName: "data",
          },
        },
      ],
    };

    const { document } = migrateWorkflowDocument(workflow);

    expect(document.nodes[0]).toMatchObject({
      type: "plugDatabase",
      parameters: {
        resource: "tools",
        toolCategory: "documents",
        operation: "htmlToPdf",
        html: "<h1>Test</h1>",
      },
    });
    expect(document.nodes[1]).toMatchObject({
      type: "plugDatabase",
      parameters: {
        resource: "tools",
        toolCategory: "identity",
        operation: "readBarcode",
        binaryPropertyName: "data",
      },
    });
  });
});
