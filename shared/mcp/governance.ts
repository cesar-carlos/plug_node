import type { CapabilityDefinition, GovernanceResult } from "./contracts";

const isActiveFilter = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim() !== "";
  }

  if (typeof value === "boolean") {
    // Explicit true/false both count as an active filter (e.g. ativo=false).
    return true;
  }

  return true;
};

const hasActiveFilter = (
  params: Readonly<Record<string, unknown>>,
  filterNames: readonly string[],
): boolean => filterNames.some((name) => isActiveFilter(params[name]));

export const resolveEffectiveMaxRows = (
  capability: CapabilityDefinition,
  params: Readonly<Record<string, unknown>>,
): number => {
  const governanceMax = capability.governance.maxRows;
  const executionMax =
    capability.executionConfig.providerType === "sql"
      ? capability.executionConfig.maxRows
      : governanceMax;

  const limitParam = params.limite ?? params.limit;
  let requested = Math.min(governanceMax, executionMax);
  if (limitParam !== null && limitParam !== undefined) {
    const limitValue = typeof limitParam === "number" ? limitParam : Number(limitParam);
    if (Number.isFinite(limitValue) && limitValue > 0) {
      requested = Math.min(requested, Math.trunc(limitValue));
    }
  }

  return Math.max(1, requested);
};

export const enforceGovernance = (
  capability: CapabilityDefinition,
  params: Readonly<Record<string, unknown>>,
): GovernanceResult => {
  const { governance } = capability;

  if (governance.requireAtLeastOneFilter === true) {
    const filterNames =
      governance.filterParamNames && governance.filterParamNames.length > 0
        ? governance.filterParamNames
        : Object.keys(capability.parameters).filter(
            (name) => name !== "limite" && name !== "limit",
          );

    if (!hasActiveFilter(params, filterNames)) {
      return {
        ok: false,
        error: "At least one business filter is required before running this capability.",
      };
    }
  }

  const limitParam = params.limite ?? params.limit;
  if (limitParam !== null && limitParam !== undefined) {
    const limitValue = typeof limitParam === "number" ? limitParam : Number(limitParam);
    if (Number.isFinite(limitValue) && limitValue > governance.maxRows) {
      return {
        ok: false,
        error: `Result limit cannot exceed ${governance.maxRows} rows.`,
      };
    }
  }

  return { ok: true };
};

export const maskSensitiveColumns = (
  rows: readonly Record<string, unknown>[],
  maskedColumns: readonly string[] | undefined,
): Record<string, unknown>[] => {
  if (!maskedColumns || maskedColumns.length === 0) {
    return [...rows];
  }

  const maskedSet = new Set(
    maskedColumns.map((column) => column.trim().toLowerCase()).filter((column) => column !== ""),
  );
  if (maskedSet.size === 0) {
    return [...rows];
  }

  return rows.map((row) => {
    const nextRow: Record<string, unknown> = { ...row };
    for (const key of Object.keys(nextRow)) {
      if (maskedSet.has(key.toLowerCase())) {
        nextRow[key] = "[redacted]";
      }
    }
    return nextRow;
  });
};
