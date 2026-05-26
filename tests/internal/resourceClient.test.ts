import { describe, expect, it, vi } from "vitest";

import { collectAllPages } from "../../packages/n8n-nodes-plug-database/generated/shared/rest/resourceClient";
import { PlugError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";

interface FakeItem {
  readonly id: string;
  readonly [key: string]: unknown;
}

describe("R2-P-01: collectAllPages page limit", () => {
  it("stops fetching when a page returns fewer items than pageSize", async () => {
    // Server reports total = 100 but page 2 returns only 1 item (less than
    // pageSize = 3), which should terminate the loop early.
    const fetchPage = vi.fn(async (query: { page?: number; pageSize?: number }) => {
      if (query.page === 1) {
        return {
          items: [{ id: "1" }, { id: "2" }, { id: "3" }],
          total: 100,
          page: 1,
          pageSize: 3,
        };
      }
      return {
        items: [{ id: "4" }],
        total: 100,
        page: 2,
        pageSize: 3,
      };
    });

    const result = await collectAllPages<
      { readonly page?: number; readonly pageSize?: number },
      FakeItem,
      Awaited<ReturnType<typeof fetchPage>>
    >({
      initialQuery: { page: 1, pageSize: 3 },
      fetchPage,
      toEnvelope: (response) => response,
      buildAggregatedResponse: (items) => ({
        items,
        total: items.length,
        page: 1,
        pageSize: items.length,
      }),
    });

    expect(result.items).toHaveLength(4);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("throws a descriptive PlugError when MAX_COLLECT_PAGES is exceeded", async () => {
    // Server reports total=10000 and keeps returning full pages — simulates broken pagination.
    const fetchPage = vi.fn(async (query: { page?: number; pageSize?: number }) => ({
      items: Array.from({ length: 10 }, (_, index) => ({
        id: `${query.page ?? 1}-${index}`,
      })),
      total: 10_000,
      page: query.page ?? 1,
      pageSize: 10,
    }));

    await expect(
      collectAllPages<
        { readonly page?: number; readonly pageSize?: number },
        FakeItem,
        Awaited<ReturnType<typeof fetchPage>>
      >({
        initialQuery: { page: 1, pageSize: 10 },
        fetchPage,
        toEnvelope: (response) => response,
        buildAggregatedResponse: (items) => ({
          items,
          total: items.length,
          page: 1,
          pageSize: items.length,
        }),
      }),
    ).rejects.toMatchObject<Partial<PlugError>>({
      code: "COLLECT_PAGES_LIMIT_EXCEEDED",
    });
  });
});
