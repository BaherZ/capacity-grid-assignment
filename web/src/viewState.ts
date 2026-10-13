import {
  normalizeRange,
  rangeError,
  shiftDate,
  type CapacityQuery,
} from "./capacity";

export type CapacityView = CapacityQuery & {
  q: string;
  over: boolean;
  page: number;
  limit: number;
};

const VIEW_KEYS = ["from", "to", "workweek", "q", "over", "page", "limit"];

export function readView(
  defaults: CapacityQuery,
  search: string,
): CapacityView {
  const params = new URLSearchParams(search);
  const requested: CapacityQuery = {
    from: params.get("from") ?? defaults.from,
    to: params.get("to") ?? defaults.to,
    workweek: params.get("workweek") === "sun-thu" ? "sun-thu" : "mon-fri",
  };
  const query = rangeError(requested) ? defaults : requested;
  const rawPage = params.get("page") ?? "1";
  const page = /^\d+$/.test(rawPage) ? Number(rawPage) : 1;
  const q = params.get("q") ?? "";
  return {
    ...query,
    q: !q.includes("\0") && [...q].length <= 100 ? q : "",
    over: params.get("over") === "true",
    page:
      Number.isSafeInteger(page) && page >= 1 && page <= 2147483647 ? page : 1,
    limit: params.get("limit") === "50" ? 50 : 25,
  };
}

export function viewURL(view: CapacityView, href: string): string {
  const url = new URL(href);
  VIEW_KEYS.forEach((key) => url.searchParams.delete(key));
  url.searchParams.set("from", view.from);
  url.searchParams.set("to", view.to);
  url.searchParams.set("workweek", view.workweek);
  if (view.q) url.searchParams.set("q", view.q);
  if (view.over) url.searchParams.set("over", "true");
  url.searchParams.set("page", String(view.page));
  url.searchParams.set("limit", String(view.limit));
  return `${url.pathname}${url.search}${url.hash}`;
}

export function currentWeekRange(
  query: CapacityQuery,
  now = new Date(),
): CapacityQuery {
  // Today follows the viewer's calendar, not the UTC date near midnight.
  const today = `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const current = normalizeRange({ ...query, from: today, to: today });
  const previous = normalizeRange(query);
  const days = Math.round(
    (Date.parse(previous.to) - Date.parse(previous.from)) / 86_400_000,
  );
  return { ...query, from: current.from, to: shiftDate(current.from, days) };
}
