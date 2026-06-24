import type { CapabilityDefinition, GovernanceResult } from "./contracts";

const isActiveFilter = (value: unknown): boolean =>
  value !== null && value !== undefined && value !== "";

const hasActiveFilter = (
  params: Readonly<Record<string, unknown>>,
  filterNames: readonly string[],
): boolean => filterNames.some((name) => isActiveFilter(params[name]));

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

  const maskedSet = new Set(maskedColumns);
  return rows.map((row) => {
    const nextRow: Record<string, unknown> = { ...row };
    for (const column of maskedSet) {
      if (column in nextRow) {
        nextRow[column] = "[redacted]";
      }
    }
    return nextRow;
  });
};
