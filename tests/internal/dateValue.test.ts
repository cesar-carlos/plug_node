import { describe, expect, it } from "vitest";

import {
  addBusinessDaysValue,
  formatDateValue,
  parseDateValue,
} from "../../shared/tools/dateValue";

describe("dateValue", () => {
  it("formats iso dates", () => {
    expect(formatDateValue("2024-06-01T12:00:00.000Z", "iso")).toBe(
      "2024-06-01T12:00:00.000Z",
    );
  });

  it("formats custom patterns without date-fns", () => {
    expect(formatDateValue("2024-06-01T15:30:45.000Z", "yyyy-MM-dd HH:mm:ss")).toBe(
      "2024-06-01 15:30:45",
    );
  });

  it("parses iso-like strings", () => {
    expect(parseDateValue("2024-06-01")).toEqual({
      iso: "2024-06-01T00:00:00.000Z",
      timestampMs: Date.parse("2024-06-01T00:00:00.000Z"),
    });
  });

  it("adds business days skipping weekends", () => {
    expect(addBusinessDaysValue("2024-06-07T12:00:00.000Z", 1)).toBe(
      "2024-06-10T12:00:00.000Z",
    );
  });
});
