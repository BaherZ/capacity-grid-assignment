export type Workweek = "mon-fri" | "sun-thu";

export type CapacityQuery = { from: string; to: string; workweek: Workweek };
export type Person = {
  id: number;
  name: string;
  weekly_hours: number;
  allocated_hours: number[];
};
export type CapacityData = CapacityQuery & {
  weeks: { start: string; end: string }[];
  people: Person[];
};

const DAY = 86_400_000;
const hoursFormatter = new Intl.NumberFormat("en", {
  maximumFractionDigits: 5,
});
const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const fullDateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function dateValue(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === value
    ? time
    : NaN;
}

export function shiftDate(value: string, days: number): string {
  return new Date(dateValue(value) + days * DAY).toISOString().slice(0, 10);
}

export function normalizeRange(query: CapacityQuery): CapacityQuery {
  const weekStart = query.workweek === "mon-fri" ? 1 : 0;
  const fromOffset =
    (new Date(dateValue(query.from)).getUTCDay() - weekStart + 7) % 7;
  const toOffset =
    (new Date(dateValue(query.to)).getUTCDay() - weekStart + 7) % 7;
  return {
    ...query,
    from: shiftDate(query.from, -fromOffset),
    to: shiftDate(query.to, 6 - toOffset),
  };
}

export function rangeError(query: CapacityQuery): string | null {
  const from = dateValue(query.from);
  const to = dateValue(query.to);
  if (!Number.isFinite(from) || !Number.isFinite(to))
    return "Choose a valid start and end date.";
  if (query.from < "0001-01-01" || query.to > "9999-12-31")
    return "Choose dates between years 1 and 9999.";
  if (to < from) return "The end date must be on or after the start date.";
  const normalized = normalizeRange(query);
  if (
    !Number.isFinite(dateValue(normalized.from)) ||
    !Number.isFinite(dateValue(normalized.to)) ||
    normalized.from < "0001-01-01" ||
    normalized.to > "9999-12-31"
  )
    return "The complete weeks must fall within years 1 through 9999.";
  if (
    (dateValue(normalized.to) - dateValue(normalized.from)) / DAY + 1 >
    106 * 7
  ) {
    return "Choose a range of 106 weeks or fewer (about two years).";
  }
  return null;
}

export function queryKey(query: CapacityQuery): string {
  return `${query.from}/${query.to}/${query.workweek}`;
}

export function hours(value: number): string {
  const rounded = hoursFormatter.format(value);
  return value > 0 && rounded === "0" ? "<0.00001" : rounded;
}

export function shortDate(value: string): string {
  return dateFormatter.format(new Date(`${value}T00:00:00Z`));
}

export function fullDate(value: string): string {
  return fullDateFormatter.format(new Date(`${value}T00:00:00Z`));
}

export function parseWeeklyHours(draft: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(draft.trim())) return null;
  const number = Number(draft);
  return number >= 0 && number <= 168 ? number : null;
}
