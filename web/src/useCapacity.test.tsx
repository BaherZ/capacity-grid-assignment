import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapacityData, CapacityQuery } from "./capacity";
import { useCapacity } from "./useCapacity";

const first: CapacityQuery = {
  from: "2026-01-05",
  to: "2026-01-11",
  workweek: "mon-fri",
};
const second: CapacityQuery = {
  from: "2026-01-12",
  to: "2026-01-18",
  workweek: "mon-fri",
};
function data(query: CapacityQuery, weeklyHours = 40): CapacityData {
  return {
    ...query,
    weeks: [{ start: query.from, end: query.to }],
    people: [
      { id: 1, name: "Ana", weekly_hours: weeklyHours, allocated_hours: [45] },
    ],
  };
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("capacity request ordering", () => {
  it("ignores a late response and late failure after a newer range loads", async () => {
    const oldRead = deferred<Response>();
    const oldRefresh = deferred<Response>();
    const mock = vi
      .fn()
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(oldRefresh.promise)
      .mockResolvedValueOnce(json(data(second)));
    vi.stubGlobal("fetch", mock);
    const { result, rerender } = renderHook(({ query }) => useCapacity(query), {
      initialProps: { query: first },
    });
    let refresh!: ReturnType<typeof result.current.refresh>;
    act(() => {
      refresh = result.current.refresh();
    });
    rerender({ query: second });
    await waitFor(() => expect(result.current.current?.from).toBe(second.from));
    await act(async () => {
      oldRead.resolve(json(data(first, 20)));
      oldRefresh.reject(new Error("old failure"));
      await refresh;
    });
    expect(result.current.current?.from).toBe(second.from);
    expect(result.current.current?.people[0].weekly_hours).toBe(40);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("invalidates a read begun during a save and refreshes the latest range", async () => {
    const patch = deferred<Response>();
    const staleRead = deferred<Response>();
    const freshRead = deferred<Response>();
    const mock = vi
      .fn()
      .mockResolvedValueOnce(json(data(first)))
      .mockReturnValueOnce(patch.promise)
      .mockReturnValueOnce(staleRead.promise)
      .mockReturnValueOnce(freshRead.promise);
    vi.stubGlobal("fetch", mock);
    const { result, rerender } = renderHook(({ query }) => useCapacity(query), {
      initialProps: { query: first },
    });
    await waitFor(() => expect(result.current.current).not.toBeNull());
    let save!: ReturnType<typeof result.current.save>;
    act(() => {
      save = result.current.save(1, 32.5);
    });
    rerender({ query: second });
    await act(async () => {
      patch.resolve(json({ id: 1, name: "Ana", weekly_hours: 32.5 }));
    });
    expect(mock.mock.calls[3][0]).toContain("from=2026-01-12");
    await act(async () => {
      staleRead.resolve(json(data(second, 40)));
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.current).toBeNull();
    await act(async () => {
      freshRead.resolve(json(data(second, 32.5)));
      await save;
    });
    expect(result.current.current?.people[0].weekly_hours).toBe(32.5);
    expect(result.current.loading).toBe(false);
  });

  it("invalidates a read when a write outcome is unconfirmed", async () => {
    const patch = deferred<Response>();
    const oldRead = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json(data(first)))
        .mockReturnValueOnce(patch.promise)
        .mockReturnValueOnce(oldRead.promise),
    );
    const { result } = renderHook(() => useCapacity(first));
    await waitFor(() => expect(result.current.current).not.toBeNull());
    let save!: ReturnType<typeof result.current.save>;
    let refresh!: ReturnType<typeof result.current.refresh>;
    act(() => {
      save = result.current.save(1, 20);
      refresh = result.current.refresh();
    });
    await act(async () => {
      patch.reject(new TypeError("Connection lost"));
      expect((await save).kind).toBe("unconfirmed");
    });
    await act(async () => {
      oldRead.resolve(json(data(first, 40)));
      await refresh;
    });
    expect(result.current.current?.people[0].weekly_hours).toBe(40);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
