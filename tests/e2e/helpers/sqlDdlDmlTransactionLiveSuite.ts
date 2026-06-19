import { afterAll, describe, expect, it } from "vitest";

import type { PlugE2EConfig } from "./e2eEnv";
import {
  assertStepTiming,
  buildCreateTableSql,
  buildDeleteAllRowsSql,
  buildDropTableSql,
  buildStressBulkUpdateSql,
  buildStressInsertCommands,
  createUniqueTableName,
  ddlStressRowIdStart,
  dropTableBestEffort,
  executeBatchStep,
  executeSqlStep,
  extractScalarFromRows,
  extractSelectRows,
  extractRowsFromBatchOutput,
  qualifiedTableName,
  readRowId,
  readRowName,
  reportStressMetrics,
  type SqlDdlDmlStepResult,
} from "./sqlDdlDmlE2eHelpers";
import { channelLabel, type SqlLiveChannel } from "./sqlE2eChannel";

const ddlDisabledSkipReason =
  "DDL/DML lifecycle E2E is opt-in. Set PLUG_E2E_DDL_ENABLED=1 when the client token allows CREATE/DROP/INSERT/UPDATE/DELETE on a staging table.";

const rowIds = {
  alpha: 1,
  beta: 2,
  gamma: 3,
  rollbackProbe: 901,
  commitProbe: 902,
} as const;

const insertRowsSql = (table: string): string =>
  `INSERT INTO ${table} (Id, Name, Amount, CreatedAt) VALUES (${rowIds.alpha}, N'Alpha', 10.50, GETDATE()), (${rowIds.beta}, N'Beta', 20.75, GETDATE()), (${rowIds.gamma}, N'Gamma', 30.00, GETDATE())`;

const selectAllRowsSql = (table: string): string =>
  `SELECT Id, Name, Amount FROM ${table} ORDER BY Id`;

const selectAlphaRowSql = (table: string): string =>
  `SELECT Id, Name, Amount FROM ${table} WHERE Id = ${rowIds.alpha}`;

const updateAlphaSql = (table: string): string =>
  `UPDATE ${table} SET Name = N'AlphaUpdated', Amount = 99.99 WHERE Id = ${rowIds.alpha}`;

const commitProbeInsertSql = (table: string): string =>
  `INSERT INTO ${table} (Id, Name, Amount, CreatedAt) VALUES (${rowIds.commitProbe}, N'CommitProbe', 1.00, GETDATE())`;

const countAllRowsSql = (table: string): string =>
  `SELECT COUNT(*) AS RowCount FROM ${table}`;

export const registerPlugSqlDdlDmlTransactionLiveE2E = (
  channel: SqlLiveChannel,
  e2eConfig: PlugE2EConfig,
): void => {
  const label = channelLabel(channel);
  const ddlConfig = e2eConfig.ddl;
  let tableName: string | undefined;

  describe.sequential(`Plug Database ${label} DDL/DML transaction lifecycle E2E`, () => {
    afterAll(async () => {
      await dropTableBestEffort(channel, e2eConfig, tableName);
    });

    it(`runs CREATE/INSERT/UPDATE/DELETE with transaction control over ${label}`, async ({
      skip,
    }) => {
      if (!ddlConfig?.enabled) {
        skip(ddlDisabledSkipReason);
      }

      const {
        stepMaxMs,
        flowMaxMs,
        stressRowCount,
        stressInsertBatchSize,
        stressStepMaxMs,
      } = ddlConfig;
      const flowStartedAt = Date.now();
      tableName = createUniqueTableName();
      const table = qualifiedTableName(tableName);
      const useBatchSelect = channel === "socket";
      const seedRowCount = 3;
      const expectedRowCountAfterStress = seedRowCount + stressRowCount;

      const recordStep = async (
        stepLabel: string,
        run: () => Promise<SqlDdlDmlStepResult>,
        options?: {
          readonly stepMaxMsOverride?: number;
          readonly stressRowCount?: number;
        },
      ): Promise<SqlDdlDmlStepResult> => {
        const step = await run();
        const limitMs = options?.stepMaxMsOverride ?? stepMaxMs;
        assertStepTiming(stepLabel, step.elapsedMs, limitMs, step.output);
        if (options?.stressRowCount !== undefined && options.stressRowCount > 0) {
          reportStressMetrics(
            stepLabel,
            step.elapsedMs,
            options.stressRowCount,
            step.output,
          );
        }
        return step;
      };

      const selectRows = async (
        stepLabel: string,
        sql: string,
        preludeCommands: readonly { readonly sql: string }[] = [],
        options?: { readonly transaction?: boolean },
      ): Promise<readonly Record<string, unknown>[]> => {
        if (useBatchSelect || preludeCommands.length > 0) {
          const commands = [...preludeCommands, { sql }];
          const step = await recordStep(stepLabel, async () =>
            executeBatchStep({
              channel,
              e2eConfig,
              skip,
              stepLabel,
              commands,
              ...(options?.transaction === true ? { transaction: true } : {}),
            }),
          );
          return extractRowsFromBatchOutput(step.output, commands.length - 1);
        }

        const step = await recordStep(stepLabel, async () =>
          executeSqlStep({
            channel,
            e2eConfig,
            skip,
            stepLabel,
            executionMode: "preserve",
            sql,
          }),
        );
        return extractSelectRows(step.output);
      };

      await recordStep("CREATE TABLE", async () =>
        executeBatchStep({
          channel,
          e2eConfig,
          skip,
          stepLabel: "CREATE TABLE",
          commands: [{ sql: buildCreateTableSql(tableName as string) }],
        }),
      );

      let insertedRows: readonly Record<string, unknown>[];
      if (useBatchSelect) {
        insertedRows = await selectRows(
          "INSERT and SELECT rows",
          selectAllRowsSql(table),
          [{ sql: insertRowsSql(table) }],
        );
      } else {
        await recordStep("INSERT rows", async () =>
          executeBatchStep({
            channel,
            e2eConfig,
            skip,
            stepLabel: "INSERT rows",
            commands: [{ sql: insertRowsSql(table) }],
          }),
        );
        insertedRows = await selectRows("SELECT after INSERT", selectAllRowsSql(table));
      }

      expect(insertedRows).toHaveLength(seedRowCount);
      expect(insertedRows.map(readRowId)).toEqual([
        rowIds.alpha,
        rowIds.beta,
        rowIds.gamma,
      ]);

      if (stressRowCount > 0) {
        const stressInsertCommands = buildStressInsertCommands(
          table,
          stressRowCount,
          stressInsertBatchSize,
        );

        await recordStep(
          `bulk INSERT ${stressRowCount} stress rows`,
          async () =>
            executeBatchStep({
              channel,
              e2eConfig,
              skip,
              stepLabel: `bulk INSERT ${stressRowCount} stress rows`,
              commands: stressInsertCommands,
            }),
          {
            stepMaxMsOverride: stressStepMaxMs,
            stressRowCount,
          },
        );

        const countedRows = await selectRows(
          "SELECT COUNT after bulk INSERT",
          countAllRowsSql(table),
        );
        expect(extractScalarFromRows(countedRows, "RowCount")).toBe(
          expectedRowCountAfterStress,
        );

        const stressBulkUpdateSql = buildStressBulkUpdateSql(table, stressRowCount);
        await recordStep(
          `bulk UPDATE ${stressRowCount} stress rows`,
          async () =>
            executeBatchStep({
              channel,
              e2eConfig,
              skip,
              stepLabel: `bulk UPDATE ${stressRowCount} stress rows`,
              commands: [{ sql: stressBulkUpdateSql }],
            }),
          {
            stepMaxMsOverride: stressStepMaxMs,
            stressRowCount,
          },
        );

        const stressSampleRows = await selectRows(
          "SELECT stress sample after bulk UPDATE",
          `SELECT TOP 1 Id, Amount FROM ${table} WHERE Id = ${ddlStressRowIdStart}`,
        );
        expect(stressSampleRows).toHaveLength(1);
        expect(
          Number(stressSampleRows[0]?.Amount ?? stressSampleRows[0]?.amount),
        ).toBeCloseTo((ddlStressRowIdStart % 100) + 0.5 + 0.01, 2);
      }

      let updatedRows: readonly Record<string, unknown>[];
      if (useBatchSelect) {
        updatedRows = await selectRows(
          "UPDATE and SELECT alpha row",
          selectAlphaRowSql(table),
          [{ sql: updateAlphaSql(table) }],
        );
      } else {
        await recordStep("UPDATE row", async () =>
          executeBatchStep({
            channel,
            e2eConfig,
            skip,
            stepLabel: "UPDATE row",
            commands: [{ sql: updateAlphaSql(table) }],
          }),
        );
        updatedRows = await selectRows("SELECT after UPDATE", selectAlphaRowSql(table));
      }

      expect(updatedRows).toHaveLength(1);
      const alphaRow = updatedRows[0] ?? {};
      expect(readRowName(alphaRow)).toBe("AlphaUpdated");
      expect(Number(alphaRow.Amount ?? alphaRow.amount)).toBeCloseTo(99.99, 2);

      await recordStep("transaction rollback batch", async () =>
        executeBatchStep({
          channel,
          e2eConfig,
          skip,
          stepLabel: "transaction rollback batch",
          transaction: true,
          expectFailure: true,
          commands: [
            {
              sql: `INSERT INTO ${table} (Id, Name, Amount, CreatedAt) VALUES (${rowIds.rollbackProbe}, N'RollbackProbe', 0.00, GETDATE())`,
            },
            { sql: "SELECT FROM PlugE2E_InvalidSyntaxProbe" },
          ],
        }),
      );

      expect(
        await selectRows(
          "SELECT after rollback",
          `SELECT Id FROM ${table} WHERE Id = ${rowIds.rollbackProbe}`,
        ),
      ).toHaveLength(0);

      let committedRows: readonly Record<string, unknown>[];
      if (useBatchSelect) {
        committedRows = await selectRows(
          "transaction commit and SELECT",
          `SELECT Id, Name FROM ${table} WHERE Id = ${rowIds.commitProbe}`,
          [{ sql: commitProbeInsertSql(table) }],
          { transaction: true },
        );
      } else {
        await recordStep("transaction commit batch", async () =>
          executeBatchStep({
            channel,
            e2eConfig,
            skip,
            stepLabel: "transaction commit batch",
            transaction: true,
            commands: [{ sql: commitProbeInsertSql(table) }],
          }),
        );
        committedRows = await selectRows(
          "SELECT after commit",
          `SELECT Id, Name FROM ${table} WHERE Id = ${rowIds.commitProbe}`,
        );
      }

      expect(committedRows).toHaveLength(1);
      expect(readRowName(committedRows[0] ?? {})).toBe("CommitProbe");

      if (useBatchSelect) {
        await recordStep(
          "DELETE all rows",
          async () =>
            executeBatchStep({
              channel,
              e2eConfig,
              skip,
              stepLabel: "DELETE all rows",
              commands: [{ sql: buildDeleteAllRowsSql(table) }],
            }),
          {
            stepMaxMsOverride: stressRowCount > 0 ? stressStepMaxMs : stepMaxMs,
            ...(stressRowCount > 0
              ? { stressRowCount: expectedRowCountAfterStress + 1 }
              : {}),
          },
        );
        expect(
          await selectRows("SELECT after DELETE", `SELECT Id FROM ${table}`),
        ).toHaveLength(0);
      } else {
        await recordStep(
          "DELETE all rows",
          async () =>
            executeBatchStep({
              channel,
              e2eConfig,
              skip,
              stepLabel: "DELETE all rows",
              commands: [{ sql: buildDeleteAllRowsSql(table) }],
            }),
          {
            stepMaxMsOverride: stressRowCount > 0 ? stressStepMaxMs : stepMaxMs,
            ...(stressRowCount > 0
              ? { stressRowCount: expectedRowCountAfterStress + 1 }
              : {}),
          },
        );
        expect(
          await selectRows("SELECT after DELETE", `SELECT Id FROM ${table}`),
        ).toHaveLength(0);
      }

      await recordStep("DROP TABLE cleanup", async () =>
        executeBatchStep({
          channel,
          e2eConfig,
          skip,
          stepLabel: "DROP TABLE cleanup",
          commands: [{ sql: buildDropTableSql(tableName as string) }],
        }),
      );
      tableName = undefined;

      const totalElapsedMs = Date.now() - flowStartedAt;
      expect(
        totalElapsedMs,
        `Full DDL/DML lifecycle exceeded flow limit (${flowMaxMs}ms, took ${totalElapsedMs}ms)`,
      ).toBeLessThan(flowMaxMs);
    });
  });
};
