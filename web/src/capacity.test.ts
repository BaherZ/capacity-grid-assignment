import { describe, expect, it } from "vitest";
import {
  dateValue,
  normalizeRange,
  parseWeeklyHours,
  rangeError,
  shiftDate,
} from "./capacity";

describe("calendar dates and workweek presets", () => {
  it("selects complete weeks with matching starts across a year boundary", () => {
    expect(
      normalizeRange({
        from: "2025-12-29",
        to: "2026-01-16",
        workweek: "mon-fri",
      }),
    ).toEqual({ from: "2025-12-29", to: "2026-01-18", workweek: "mon-fri" });
    expect(
      normalizeRange({
        from: "2025-12-29",
        to: "2026-01-16",
        workweek: "sun-thu",
      }),
    ).toEqual({ from: "2025-12-28", to: "2026-01-17", workweek: "sun-thu" });
  });

  it("keeps navigation in calendar days across DST and leap days", () => {
    expect(shiftDate("2026-03-29", 7)).toBe("2026-04-05");
    expect(shiftDate("2026-10-25", -7)).toBe("2026-10-18");
    expect(shiftDate("2024-02-28", 1)).toBe("2024-02-29");
    expect(shiftDate("2024-02-29", 1)).toBe("2024-03-01");
    expect(Number.isNaN(dateValue("2026-02-29"))).toBe(true);
  });

  it("bounds complete weeks and guards calendar extremes", () => {
    expect(
      rangeError({ from: "2025-01-01", to: "2027-01-01", workweek: "mon-fri" }),
    ).toBeNull();
    expect(
      rangeError({ from: "2025-01-01", to: "2027-02-01", workweek: "mon-fri" }),
    ).toMatch(/106 weeks/);
    expect(
      rangeError({ from: "0001-01-01", to: "0001-01-01", workweek: "mon-fri" }),
    ).toBeNull();
    expect(
      rangeError({ from: "0001-01-01", to: "0001-01-01", workweek: "sun-thu" }),
    ).toMatch(/complete weeks/);
    expect(
      rangeError({ from: "9999-12-31", to: "9999-12-31", workweek: "mon-fri" }),
    ).toMatch(/complete weeks/);
    expect(
      rangeError({ from: "0000-01-01", to: "0000-01-01", workweek: "mon-fri" }),
    ).not.toBeNull();
  });
});

describe("weekly hours drafts", () => {
  it("distinguishes a valid zero from blank and rejects excess precision", () => {
    expect(parseWeeklyHours("0")).toBe(0);
    expect(parseWeeklyHours("32.75")).toBe(32.75);
    expect(parseWeeklyHours("168")).toBe(168);
    for (const draft of [
      "",
      " ",
      "-1",
      "168.01",
      "20.001",
      "1e2",
      "NaN",
      "0x10",
    ])
      expect(parseWeeklyHours(draft)).toBeNull();
  });
});
