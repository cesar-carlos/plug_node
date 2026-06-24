import type { CapabilityDefinition, ToolSchema } from "./contracts";

export type CapabilityRegistry = ReadonlyMap<string, CapabilityDefinition>;

const buildSemanticDescription = (capability: CapabilityDefinition): string => {
  const tags = capability.tags?.length ? `\nTags: ${capability.tags.join(", ")}` : "";
  return [
    capability.description,
    "",
    `When to use: ${capability.whenToUse}`,
    `When not to use: ${capability.whenNotToUse}`,
    tags,
  ]
    .filter((line) => line !== "")
    .join("\n");
};

const toToolInputProperty = (
  schema: CapabilityDefinition["parameters"][string],
): ToolSchema["inputSchema"]["properties"][string] => ({
  type: schema.type,
  description: schema.description,
  ...(schema.default !== undefined ? { default: schema.default } : {}),
  ...(schema.minimum !== undefined ? { minimum: schema.minimum } : {}),
  ...(schema.maximum !== undefined ? { maximum: schema.maximum } : {}),
});

const toToolSchema = (capability: CapabilityDefinition): ToolSchema => {
  const properties = Object.fromEntries(
    Object.entries(capability.parameters).map(([name, schema]) => [
      name,
      toToolInputProperty(schema),
    ]),
  );
  const required = Object.entries(capability.parameters)
    .filter(([, schema]) => schema.required === true)
    .map(([name]) => name);

  return {
    name: capability.name,
    description: buildSemanticDescription(capability),
    inputSchema: {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
  };
};

export const buildRegistry = (
  definitions: readonly CapabilityDefinition[],
): CapabilityRegistry => {
  const registry = new Map<string, CapabilityDefinition>();
  for (const definition of definitions) {
    if (registry.has(definition.name)) {
      throw new Error(`Duplicate capability name: ${definition.name}`);
    }
    registry.set(definition.name, definition);
  }
  return registry;
};

export const listCapabilities = (registry: CapabilityRegistry): ToolSchema[] =>
  [...registry.values()].map(toToolSchema);

export const lookupCapability = (
  registry: CapabilityRegistry,
  name: string,
): CapabilityDefinition | undefined => registry.get(name);
