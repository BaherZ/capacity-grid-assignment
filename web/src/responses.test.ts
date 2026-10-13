import { describe, expect, it } from "vitest";
import { parseCapacityResponse, parseSavedPerson } from "./responses";
import type { CapacityData, CapacityQuery } from "./capacity";

const query: CapacityQuery = { from: "2026-01-07", to: "2026-01-14", workweek: "mon-fri" };
function valid(): CapacityData {
  return {
    from: "2026-01-05", to: "2026-01-18", workweek: "mon-fri",
    weeks: [{ start: "2026-01-05", end: "2026-01-11" }, { start: "2026-01-12", end: "2026-01-18" }],
    people: [{ id: 1, name: "نور الحسن", weekly_hours: 0, allocated_hours: [0, 0.03125] }],
  };
}

describe("capacity response validation", () => {
  it("accepts complete normalized weeks, zero capacity, and fractional allocation without rounding", () => {
    expect(parseCapacityResponse(valid(), query)).toEqual(valid());
    const empty = { ...valid(), people: [] };
    expect(parseCapacityResponse(empty, query)).toEqual(empty);
  });

  it.each([
    ["missing people", (data: CapacityData) => ({ ...data, people: null })],
    ["missing allocation", (data: CapacityData) => ({ ...data, people: [{ ...data.people[0], allocated_hours: [0] }] })],
    ["duplicate person", (data: CapacityData) => ({ ...data, people: [data.people[0], data.people[0]] })],
    ["different calendar", (data: CapacityData) => ({ ...data, workweek: "sun-thu" })],
    ["different range", (data: CapacityData) => ({ ...data, from: "2026-01-12" })],
    ["swapped weeks", (data: CapacityData) => ({ ...data, weeks: [...data.weeks].reverse() })],
    ["missing week", (data: CapacityData) => ({ ...data, weeks: data.weeks.slice(1) })],
    ["negative allocation", (data: CapacityData) => ({ ...data, people: [{ ...data.people[0], allocated_hours: [0, -1] }] })],
    ["nonfinite allocation", (data: CapacityData) => ({ ...data, people: [{ ...data.people[0], allocated_hours: [0, Infinity] }] })],
    ["numeric string", (data: CapacityData) => ({ ...data, people: [{ ...data.people[0], weekly_hours: "40" }] })],
    ["unsafe id", (data: CapacityData) => ({ ...data, people: [{ ...data.people[0], id: Number.MAX_SAFE_INTEGER + 1 }] })],
  ] as const)("rejects %s before rendering", (_, change) => {
    expect(() => parseCapacityResponse(change(valid()), query)).toThrow(/Capacity data/);
  });

  it("checks Sunday-start and year-boundary dates against the requested calendar", () => {
    const sunday: CapacityQuery = { from: "2025-12-31", to: "2026-01-02", workweek: "sun-thu" };
    const data = {
      from: "2025-12-28", to: "2026-01-03", workweek: "sun-thu",
      weeks: [{ start: "2025-12-28", end: "2026-01-03" }], people: [],
    };
    expect(parseCapacityResponse(data, sunday)).toEqual(data);
    expect(() => parseCapacityResponse({ ...data, weeks: [{ start: "2025-12-29", end: "2026-01-04" }] }, sunday)).toThrow();
  });
});

describe("save confirmation validation", () => {
  it("accepts a canonical saved person including zero and decimal hours", () => {
    for (const weekly_hours of [0, 32.25, 168]) {
      const person = { id: 1, name: "Ana", weekly_hours };
      expect(parseSavedPerson(person, 1)).toEqual(person);
    }
  });

  it.each([
    null,
    { id: 2, name: "Ana", weekly_hours: 40 },
    { id: 1, weekly_hours: 40 },
    { id: 1, name: "Ana", weekly_hours: "40" },
    { id: 1, name: "Ana", weekly_hours: -1 },
    { id: 1, name: "Ana", weekly_hours: 169 },
    { id: 1, name: "Ana", weekly_hours: NaN },
  ])("rejects an invalid or different-person confirmation: %j", (value) => {
    expect(() => parseSavedPerson(value, 1)).toThrow(/did not confirm/);
  });
});
