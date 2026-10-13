import { describe, expect, it } from "vitest";
import { currentWeekRange, readView, viewURL } from "./viewState";
import { normalizeRange, type CapacityQuery } from "./capacity";

const defaults: CapacityQuery = {
  from: "2025-12-29",
  to: "2026-01-16",
  workweek: "mon-fri",
};

describe("shareable capacity views", () => {
  it("round-trips the complete view and preserves unrelated URL state", () => {
    const view = {
      ...defaults,
      q: "نور & Ana",
      over: true,
      page: 3,
      limit: 50,
    };
    const url = viewURL(
      view,
      "https://example.com/capacity?campaign=test#team",
    );
    expect(
      readView(defaults, new URL(url, "https://example.com").search),
    ).toEqual(view);
    expect(url).toContain("campaign=test");
    expect(url).toContain("#team");
  });

  it.each([
    "?from=2026-02-30&to=2026-03-01&page=-1&limit=100",
    "?from=2026-03-01&to=2026-01-01&page=1.5&limit=0",
    "?from=0000-01-01&to=9999-12-31&page=9999999999999999999&limit=NaN",
  ])("falls back safely from invalid URL inputs: %s", (search) => {
    expect(readView(defaults, search)).toEqual({
      ...defaults,
      q: "",
      over: false,
      page: 1,
      limit: 25,
    });
  });

  it("rejects unusable search text and does not enable a malformed filter", () => {
    expect(readView(defaults, "?q=%00&over=yes")).toMatchObject({
      q: "",
      over: false,
    });
    expect(readView(defaults, `?q=${"a".repeat(101)}`)).toMatchObject({
      q: "",
    });
  });

  it.each(["mon-fri", "sun-thu"] as const)(
    "moves %s to this week while preserving normalized span",
    (workweek) => {
      const original = { ...defaults, workweek };
      const result = currentWeekRange(original, new Date(2026, 9, 13, 23, 45));
      expect(result.from).toBe(
        workweek === "mon-fri" ? "2026-10-12" : "2026-10-11",
      );
      const previous = normalizeRange(original);
      expect(Date.parse(result.to) - Date.parse(result.from)).toBe(
        Date.parse(previous.to) - Date.parse(previous.from),
      );
      expect(result.workweek).toBe(workweek);
    },
  );
});
