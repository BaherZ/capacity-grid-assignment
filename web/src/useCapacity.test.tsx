import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapacityData, CapacityQuery } from "./capacity";
import { useCapacity, type SaveResult } from "./useCapacity";

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
  it("confirms a save and releases the save guard before its refresh finishes", async () => {
    const patch = deferred<Response>();
    const freshRead = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json(data(first)))
        .mockReturnValueOnce(patch.promise)
        .mockReturnValueOnce(freshRead.promise),
    );
    const { result } = renderHook(() => useCapacity(first));
    await waitFor(() => expect(result.current.current).not.toBeNull());
    let save!: ReturnType<typeof result.current.save>;
    let saved: SaveResult | undefined;
    act(() => {
      save = result.current.save(1, 32.5);
      void save.then((value) => {
        saved = value;
      });
    });
    expect(result.current.saving).toBe(true);
    expect(result.current.current?.people[0].weekly_hours).toBe(40);

    await act(async () => {
      patch.resolve(json({ id: 1, name: "Ana", weekly_hours: 32.5 }));
    });
    // The refresh deliberately remains pending: confirmation must not wait for it.
    expect(saved?.kind).toBe("saved");
    expect(result.current.saving).toBe(false);
    expect(result.current.loading).toBe(true);
    expect(result.current.current?.people[0].weekly_hours).toBe(32.5);
    if (saved?.kind !== "saved") throw new Error("Expected a confirmed save");
    const refresh = saved.refresh;

    await act(async () => {
      freshRead.reject(new Error("Refresh unavailable"));
      expect(await refresh).toEqual({ error: "Refresh unavailable" });
    });
    expect(result.current.current?.people[0].weekly_hours).toBe(32.5);
    expect(result.current.saving).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("Refresh unavailable");
  });

  it("allows a newer save while refreshing and ignores the older refresh afterward", async () => {
    const olderRead = deferred<Response>();
    const newerPatch = deferred<Response>();
    const newerRead = deferred<Response>();
    const mock = vi
      .fn()
      .mockResolvedValueOnce(json(data(first)))
      .mockResolvedValueOnce(json({ id: 1, name: "Ana", weekly_hours: 32 }))
      .mockReturnValueOnce(olderRead.promise)
      .mockReturnValueOnce(newerPatch.promise)
      .mockReturnValueOnce(newerRead.promise);
    vi.stubGlobal("fetch", mock);
    const { result } = renderHook(() => useCapacity(first));
    await waitFor(() => expect(result.current.current).not.toBeNull());
    let olderSave: SaveResult | undefined;
    await act(async () => {
      olderSave = await result.current.save(1, 32);
    });
    expect(olderSave?.kind).toBe("saved");
    expect(result.current.saving).toBe(false);
    expect(result.current.loading).toBe(true);
    if (olderSave?.kind !== "saved") throw new Error("Expected a confirmed save");
    const olderRefresh = olderSave.refresh;

    let save!: ReturnType<typeof result.current.save>;
    act(() => {
      save = result.current.save(1, 48);
    });
    expect(mock.mock.calls[3][1].method).toBe("PATCH");
    expect(result.current.saving).toBe(true);
    expect(result.current.current?.people[0].weekly_hours).toBe(32);

    let newerSave: SaveResult | undefined;
    await act(async () => {
      newerPatch.resolve(json({ id: 1, name: "Ana", weekly_hours: 48 }));
      newerSave = await save;
    });
    expect(newerSave?.kind).toBe("saved");
    expect(result.current.current?.people[0].weekly_hours).toBe(48);
    expect(result.current.saving).toBe(false);
    if (newerSave?.kind !== "saved") throw new Error("Expected a confirmed save");
    const newerRefresh = newerSave.refresh;

    await act(async () => {
      olderRead.resolve(json(data(first, 32)));
      expect(await olderRefresh).toEqual({ obsolete: true });
    });
    expect(result.current.current?.people[0].weekly_hours).toBe(48);
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    await act(async () => {
      newerRead.resolve(json(data(first, 48)));
      await newerRefresh;
    });
    expect(result.current.current?.people[0].weekly_hours).toBe(48);
    expect(result.current.loading).toBe(false);
  });

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
