import { describe, expect, it } from "vitest";

import { executePerInputItem } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugItemExecution";
import { createMockExecuteContext } from "../helpers/mockExecuteFunctions";

describe("executePerInputItem", () => {
  it("stops scheduling after failure and waits for active work before rejecting", async () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "fixture",
        password: "fixture",
        baseUrl: "https://fixture.invalid",
      },
      parameters: {},
      responses: [],
      inputData: Array.from({ length: 6 }, () => ({ json: {} })),
    });
    const gate = Promise.withResolvers<void>();
    const started: number[] = [];
    let settled = false;
    const result = executePerInputItem(
      context,
      async (index) => {
        started.push(index);
        if (index === 0) throw new Error("first failure");
        await gate.promise;
        throw new Error("later failure");
      },
      { maxConcurrency: 2 },
    );
    const checked = expect(result).rejects.toThrow("first failure");
    void result.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    const settledBeforeRelease = settled;
    gate.resolve();
    await checked;
    expect(settledBeforeRelease).toBe(false);
    expect(started).toEqual([0, 1]);
  });

  it.each([1, 2])(
    "delivers large output arrays in order with concurrency %s",
    async (maxConcurrency) => {
      const context = createMockExecuteContext({
        credentials: {
          user: "fixture",
          password: "fixture",
          baseUrl: "https://fixture.invalid",
        },
        parameters: {},
        responses: [],
        inputData: [{ json: {} }, { json: {} }],
      });
      const rows = Array.from({ length: 150000 }, (_, id) => ({ json: { id } }));
      const result = await executePerInputItem(
        context,
        async (index) => (index === 0 ? rows : [{ json: { id: 150000 } }]),
        { maxConcurrency },
      );
      expect(result[0]).toHaveLength(150001);
      expect(result[0].every((item, index) => item.json.id === index)).toBe(true);
      expect(rows).toHaveLength(150000);
      expect(result[0]).not.toBe(rows);
    },
  );

  it("runs items sequentially by default and preserves output order", async () => {
    const callOrder: number[] = [];
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {},
      responses: [],
      inputData: [{ json: { id: 1 } }, { json: { id: 2 } }, { json: { id: 3 } }],
    });

    const result = await executePerInputItem(context, async (itemIndex, item) => {
      callOrder.push(itemIndex);
      return { json: { ...item.json, processed: true } };
    });

    expect(callOrder).toEqual([0, 1, 2]);
    expect(result[0].map((item) => item.json)).toEqual([
      { id: 1, processed: true },
      { id: 2, processed: true },
      { id: 3, processed: true },
    ]);
  });

  it("runs items with bounded concurrency while preserving output order", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const started: number[] = [];
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {},
      responses: [],
      inputData: Array.from({ length: 6 }, (_, index) => ({ json: { id: index } })),
    });

    const result = await executePerInputItem(
      context,
      async (itemIndex) => {
        started.push(itemIndex);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return [
          { json: { id: itemIndex, slot: "a" } },
          { json: { id: itemIndex, slot: "b" } },
        ];
      },
      { maxConcurrency: 3 },
    );

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(started).toHaveLength(6);
    expect(result[0].map((item) => item.json)).toEqual([
      { id: 0, slot: "a" },
      { id: 0, slot: "b" },
      { id: 1, slot: "a" },
      { id: 1, slot: "b" },
      { id: 2, slot: "a" },
      { id: 2, slot: "b" },
      { id: 3, slot: "a" },
      { id: 3, slot: "b" },
      { id: 4, slot: "a" },
      { id: 4, slot: "b" },
      { id: 5, slot: "a" },
      { id: 5, slot: "b" },
    ]);
  });

  it("records per-item errors in order when continueOnFail is enabled", async () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {},
      responses: [],
      inputData: [{ json: { id: 1 } }, { json: { id: 2 } }, { json: { id: 3 } }],
      continueOnFail: true,
    });

    const result = await executePerInputItem(
      context,
      async (itemIndex) => {
        if (itemIndex === 1) {
          throw new Error("item 1 failed");
        }

        return { json: { id: itemIndex, ok: true } };
      },
      { maxConcurrency: 2 },
    );

    expect(result[0]).toHaveLength(3);
    expect(result[0][0].json).toMatchObject({ id: 0, ok: true });
    expect(result[0][1].json).toMatchObject({
      id: 2,
      error: { message: "item 1 failed", name: "Error" },
    });
    expect(result[0][1].pairedItem).toEqual({ item: 1 });
    expect(result[0][2].json).toMatchObject({ id: 2, ok: true });
  });

  it("throws the first failing item error when continueOnFail is disabled", async () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {},
      responses: [],
      inputData: [{ json: { id: 1 } }, { json: { id: 2 } }],
    });

    await expect(
      executePerInputItem(
        context,
        async (itemIndex) => {
          if (itemIndex === 0) {
            throw new Error("boom");
          }

          return { json: { id: itemIndex } };
        },
        { maxConcurrency: 2 },
      ),
    ).rejects.toThrow("boom");
  });
});
