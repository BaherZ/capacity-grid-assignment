import {
  dateValue,
  normalizeRange,
  shiftDate,
  type CapacityData,
  type CapacityQuery,
  type SavedPerson,
} from "./capacity";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hours(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function person(value: unknown): value is SavedPerson & Record<string, unknown> {
  return record(value) &&
    Number.isSafeInteger(value.id) && Number(value.id) > 0 &&
    typeof value.name === "string" && hours(value.weekly_hours);
}

// TypeScript types do not validate network data. Reject inconsistent dates and
// cell counts before they can label allocations with the wrong week or show a
// missing allocation as zero. Extra fields are allowed for API compatibility.
export function parseCapacityResponse(value: unknown, query: CapacityQuery): CapacityData {
  const invalid = () => new Error("Capacity data was incomplete or did not match these weeks. Please try again.");
  const expected = normalizeRange(query);
  if (!record(value) || value.from !== expected.from || value.to !== expected.to ||
      value.workweek !== expected.workweek || !Array.isArray(value.weeks) ||
      !Array.isArray(value.people)) throw invalid();

  const weekCount = ((dateValue(expected.to) - dateValue(expected.from)) / 86_400_000 + 1) / 7;
  if (!Number.isInteger(weekCount) || value.weeks.length !== weekCount) throw invalid();
  for (let index = 0; index < value.weeks.length; index++) {
    const week = value.weeks[index];
    if (!record(week) || week.start !== shiftDate(expected.from, index * 7) ||
        week.end !== shiftDate(expected.from, index * 7 + 6)) throw invalid();
  }

  const ids = new Set<number>();
  for (const row of value.people) {
    if (!person(row) || !record(row) || ids.has(row.id) ||
        !Array.isArray(row.allocated_hours) || row.allocated_hours.length !== weekCount ||
        !row.allocated_hours.every(hours)) throw invalid();
    ids.add(row.id);
  }
  return value as CapacityData;
}

export function parseSavedPerson(value: unknown, expectedID: number): SavedPerson {
  if (!person(value) || value.id !== expectedID || value.weekly_hours > 168) {
    throw new Error("The save response did not confirm this person's capacity.");
  }
  return value;
}
