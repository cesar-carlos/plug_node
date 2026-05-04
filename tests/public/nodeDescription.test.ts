import { describe, expect, it } from "vitest";

import { PlugDatabase } from "../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/PlugDatabase.node";
import { PlugDatabaseClientAccess } from "../../packages/n8n-nodes-plug-database/nodes/PlugDatabaseClientAccess/PlugDatabaseClientAccess.node";
import { PlugDatabaseUserAccess } from "../../packages/n8n-nodes-plug-database/nodes/PlugDatabaseUserAccess/PlugDatabaseUserAccess.node";
import { PlugDatabaseAdvanced } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvanced/PlugDatabaseAdvanced.node";
import { PlugDatabaseAdvancedClientAccess } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedClientAccess/PlugDatabaseAdvancedClientAccess.node";
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
});
