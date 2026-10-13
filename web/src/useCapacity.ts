import { useCallback, useEffect, useRef, useState } from "react";
import {
  queryKey,
  type CapacityData,
  type CapacityQuery,
  type Person,
} from "./capacity";

type ReadState = {
  data: CapacityData | null;
  key: string | null;
  loading: boolean;
  error: string | null;
  // Advances only when the latest GET succeeds, not when a write clears an error.
  readRevision: number;
};
export type ReadResult = {
  data?: CapacityData;
  error?: string;
  obsolete?: boolean;
};
export type SaveResult =
  | {
      kind: "saved";
      person: Pick<Person, "id" | "name" | "weekly_hours">;
      refresh: Promise<ReadResult>;
    }
  | { kind: "rejected" | "unconfirmed"; message: string };

async function errorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
    )
      return body.error;
  } catch {
    /* Keep the useful fallback for non-JSON proxy errors. */
  }
  return fallback;
}

export function useCapacity(query: CapacityQuery) {
  const [state, setState] = useState<ReadState>({
    data: null,
    key: null,
    loading: true,
    error: null,
    readRevision: 0,
  });
  const [saving, setSaving] = useState(false);
  const latestQuery = useRef(query);
  latestQuery.current = query;
  const mounted = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const saveInFlight = useRef(false);

  const read = useCallback(
    async (target: CapacityQuery): Promise<ReadResult> => {
      const version = ++generation.current;
      controller.current?.abort();
      const request = new AbortController();
      controller.current = request;
      const timeout = setTimeout(() => request.abort(), 30_000);
      const isCurrent = () => mounted.current && version === generation.current;
      setState((previous) => ({ ...previous, loading: true, error: null }));
      try {
        const params = new URLSearchParams(target);
        const response = await fetch(`/api/capacity?${params}`, {
          signal: request.signal,
          cache: "no-store",
        });
        if (!response.ok)
          throw new Error(
            await errorMessage(
              response,
              "Capacity could not be loaded. Please try again.",
            ),
          );
        const data = (await response.json()) as CapacityData;
        if (!isCurrent()) return { obsolete: true };
        setState({
          data,
          key: queryKey(target),
          loading: false,
          error: null,
          readRevision: version,
        });
        return { data };
      } catch (error) {
        if (!isCurrent()) return { obsolete: true };
        const message = request.signal.aborted
          ? "Loading timed out. Please try again."
          : error instanceof Error
            ? error.message
            : "Capacity could not be loaded. Please try again.";
        setState((previous) => ({
          ...previous,
          loading: false,
          error: message,
        }));
        return { error: message };
      } finally {
        clearTimeout(timeout);
      }
    },
    [],
  );

  const refresh = useCallback(() => read(latestQuery.current), [read]);

  useEffect(() => {
    mounted.current = true;
    void read(query);
    return () => {
      mounted.current = false;
      ++generation.current;
      controller.current?.abort();
    };
  }, [query.from, query.to, query.workweek, read]);

  const save = useCallback(
    async (id: number, weeklyHours: number): Promise<SaveResult> => {
      if (saveInFlight.current)
        return { kind: "rejected", message: "Another change is still saving." };
      saveInFlight.current = true;
      setSaving(true);
      const request = new AbortController();
      const timeout = setTimeout(() => request.abort(), 30_000);
      const unknownOutcome = (): SaveResult => {
        // A transport/server failure can happen after commit. Older reads are unsafe.
        ++generation.current;
        controller.current?.abort();
        if (mounted.current) {
          setState((previous) => ({
            ...previous,
            loading: false,
            error: null,
          }));
        }
        return {
          kind: "unconfirmed",
          message:
            "We could not confirm whether your change was saved. Check the current value before saving again.",
        };
      };
      try {
        const response = await fetch(`/api/people/${id}`, {
          method: "PATCH",
          signal: request.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weekly_hours: weeklyHours }),
        });
        if (!response.ok) {
          const message = await errorMessage(
            response,
            "The server could not save this change.",
          );
          if (response.status >= 400 && response.status < 500)
            return { kind: "rejected", message };
          return unknownOutcome();
        }
        const person = (await response.json()) as Pick<
          Person,
          "id" | "name" | "weekly_hours"
        >;
        // A read begun before OR during this write may still contain the old capacity.
        ++generation.current;
        controller.current?.abort();
        if (mounted.current) {
          setState((previous) => ({
            ...previous,
            data: previous.data
              ? {
                  ...previous.data,
                  people: previous.data.people.map((row) =>
                    row.id === id
                      ? { ...row, weekly_hours: person.weekly_hours }
                      : row,
                  ),
                }
              : null,
          }));
        }
        // The write is confirmed; refreshing its surrounding data is separate work.
        // Return immediately so a slow read cannot keep the editor in "Saving…".
        return { kind: "saved", person, refresh: refresh() };
      } catch {
        return unknownOutcome();
      } finally {
        clearTimeout(timeout);
        saveInFlight.current = false;
        if (mounted.current) setSaving(false);
      }
    },
    [refresh],
  );

  return {
    ...state,
    saving,
    save,
    refresh,
    current: state.key === queryKey(query) ? state.data : null,
  };
}
