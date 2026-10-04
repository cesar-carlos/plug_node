import { describe, expect, it } from "vitest";

import words from "../fixtures/number-to-words-compatibility.json";
import { numberToWordsValue } from "../../packages/n8n-nodes-plug-database/generated/shared/tools/dateValue";
import {
  csvToJson,
  jsonToCsv,
  transformJson,
  validateJsonSchema,
} from "../../packages/n8n-nodes-plug-database/generated/shared/tools/data";
import { markdownToHtmlDocument } from "../../packages/n8n-nodes-plug-database/generated/shared/tools/documents";

describe("updated runtime dependency contracts", () => {
  it.each(words)(
    "should preserve number-to-words for $value in $locale",
    async (fixture) => {
      await expect(numberToWordsValue(fixture.value, fixture.locale)).resolves.toBe(
        fixture.expected,
      );
    },
  );

  it("should round-trip CSV quotes and Unicode", () => {
    const rows = [{ name: 'Olá, "Plug"', city: "Cuiabá" }];
    expect(csvToJson(jsonToCsv(rows, {}), {})).toEqual(rows);
  });

  it("should evaluate JSONata asynchronously", async () => {
    await expect(
      transformJson({ rows: [{ amount: 2 }, { amount: 3 }] }, "$sum(rows.amount)"),
    ).resolves.toBe(5);
  });

  it("should render Markdown as a UTF-8 HTML document", async () => {
    await expect(markdownToHtmlDocument("# Olá\n\n**Plug**")).resolves.toContain(
      "<strong>Plug</strong>",
    );
  });

  it("should preserve JSON Schema format validation", () => {
    expect(
      validateJsonSchema(
        { email: "invalid" },
        { type: "object", properties: { email: { type: "string", format: "email" } } },
      ),
    ).toMatchObject({ valid: false });
  });
});
