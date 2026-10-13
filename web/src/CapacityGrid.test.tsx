import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapacityGrid } from "./CapacityGrid";
import {
  normalizeRange,
  type CapacityData,
  type CapacityQuery,
} from "./capacity";

const query: CapacityQuery = {
  from: "2025-12-29",
  to: "2026-01-16",
  workweek: "mon-fri",
};
function fixture(weeklyHours = 40): CapacityData {
  return {
    ...normalizeRange(query),
    weeks: [
      { start: "2025-12-29", end: "2026-01-04" },
      { start: "2026-01-05", end: "2026-01-11" },
      { start: "2026-01-12", end: "2026-01-18" },
    ],
    people: [
      {
        id: 1,
        name: "Ana",
        weekly_hours: weeklyHours,
        allocated_hours: [40, 45, 0],
      },
      { id: 2, name: "Eli", weekly_hours: 0, allocated_hours: [0, 20, 0] },
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
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
async function openEditor() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Edit weekly hours for Ana" }),
  );
  return screen.getByRole("textbox", { name: "Weekly hours for Ana" });
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("weekly capacity editing", () => {
  it("confirms a save while refreshing and explains why the filtered person disappears", async () => {
    const refresh = deferred<Response>();
    const mock = vi
      .fn()
      .mockResolvedValueOnce(json(fixture()))
      .mockResolvedValueOnce(json({ id: 1, name: "Ana", weekly_hours: 48 }))
      .mockReturnValueOnce(refresh.promise);
    vi.stubGlobal("fetch", mock);
    render(<CapacityGrid from={query.from} to={query.to} />);
    const input = await openEditor();
    fireEvent.click(screen.getByRole("checkbox", { name: "Over capacity only" }));
    fireEvent.change(input, { target: { value: "48" } });
    fireEvent.click(screen.getByRole("button", { name: "Save capacity" }));

    expect(await screen.findByText("Saved · 48 h/week.")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Saving…" }),
    ).not.toBeInTheDocument();
    expect(input).toBeEnabled();
    expect(screen.getByRole("button", { name: "Close editor" })).toBeEnabled();
    expect(screen.getByText(/Updating capacity…/)).toBeVisible();
    expect(screen.getByText(/Ana is within capacity and is hidden/)).toBeVisible();
    expect(screen.queryByRole("row", { name: /Ana/ })).not.toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Eli/ })).toBeVisible();
    expect(
      within(
        screen.getByRole("region", { name: "Entire team summary" }),
      ).getByText("48"),
    ).toBeVisible();

    await act(async () => refresh.resolve(json(fixture(48))));
    expect(screen.queryByText(/Updating capacity…/)).not.toBeInTheDocument();
    expect(screen.getByText("Saved · 48 h/week.")).toBeVisible();
  });

  it.each([
    { action: "edit", status: 200 },
    { action: "edit", status: 500 },
    { action: "reopen", status: 200 },
    { action: "reopen", status: 500 },
  ])(
    "preserves a newer draft after $action when the automatic refresh returns $status",
    async ({ action, status }) => {
      const refresh = deferred<Response>();
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(json(fixture()))
          .mockResolvedValueOnce(json({ id: 1, name: "Ana", weekly_hours: 32 }))
          .mockReturnValueOnce(refresh.promise),
      );
      render(<CapacityGrid from={query.from} to={query.to} />);
      fireEvent.change(await openEditor(), { target: { value: "32" } });
      fireEvent.click(screen.getByRole("button", { name: "Save capacity" }));
      await screen.findByText("Saved · 32 h/week.");
      if (action === "reopen") {
        fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
        expect(await openEditor()).toHaveValue("32");
      }
      const input = screen.getByRole("textbox", { name: "Weekly hours for Ana" });
      fireEvent.change(input, { target: { value: "25" } });
      await act(async () =>
        refresh.resolve(
          json(
            status === 200 ? fixture(32) : { error: "Refresh unavailable." },
            status,
          ),
        ),
      );
      expect(input).toHaveValue("25");
      expect(screen.getByRole("button", { name: "Save capacity" })).toBeEnabled();
      expect(screen.queryByText(/Saved ·/)).not.toBeInTheDocument();
      expect(screen.queryByText(/your change is saved/)).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Edit weekly hours for Ana" }),
      ).toHaveTextContent("32 h / week");
      if (status === 500)
        expect(screen.getByRole("button", { name: "Retry refresh" })).toBeEnabled();
    },
  );

  it("keeps a rejected draft while navigating and lets Cancel restore keyboard focus", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(json(fixture()))
      .mockResolvedValueOnce(json({ error: "This change was rejected." }, 400))
      .mockImplementation(() => Promise.resolve(json(fixture())));
    vi.stubGlobal("fetch", mock);
    render(<CapacityGrid from={query.from} to={query.to} />);
    fireEvent.change(await openEditor(), { target: { value: "32.75" } });
    fireEvent.click(screen.getByRole("button", { name: "Save capacity" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This change was rejected.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(3));
    expect(
      screen.getByRole("textbox", { name: "Weekly hours for Ana" }),
    ).toHaveValue("32.75");
    await screen.findByRole("button", { name: "Edit weekly hours for Ana" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("searchbox", { name: "Search all people" }),
    ).toHaveFocus();
  });

  it("separates a confirmed zero-hour save from a failed refresh and only retries the read", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(json(fixture()))
      .mockResolvedValueOnce(json({ id: 1, name: "Ana", weekly_hours: 0 }))
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(json(fixture(0)));
    vi.stubGlobal("fetch", mock);
    render(<CapacityGrid from={query.from} to={query.to} />);
    fireEvent.change(await openEditor(), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save capacity" }));
    expect(
      await screen.findByText(
        /Saved · 0 h\/week. The capacity refresh failed/,
      ),
    ).toBeVisible();
    const row = screen.getByRole("row", { name: /Ana/ });
    expect(within(row).getByText("45 h over")).toBeVisible();
    expect(within(row).getByText("40 h over")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    await screen.findByText(
      "Your change was saved. The latest capacity has now been loaded.",
    );
    expect(
      mock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(1);
    expect(JSON.parse(mock.mock.calls[1][1].body)).toEqual({ weekly_hours: 0 });
  });

  it("keeps a newer unsaved draft editable when an earlier refresh retry completes", async () => {
    const refresh = deferred<Response>();
    const mock = vi
      .fn()
      .mockResolvedValueOnce(json(fixture()))
      .mockResolvedValueOnce(json({ id: 1, name: "Ana", weekly_hours: 32 }))
      .mockRejectedValueOnce(new Error("Offline"))
      .mockReturnValueOnce(refresh.promise);
    vi.stubGlobal("fetch", mock);
    render(<CapacityGrid from={query.from} to={query.to} />);
    const input = await openEditor();
    fireEvent.change(input, { target: { value: "32" } });
    fireEvent.click(screen.getByRole("button", { name: "Save capacity" }));
    await screen.findByText(/Saved · 32 h\/week. The capacity refresh failed/);

    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    fireEvent.change(input, { target: { value: "25" } });
    await act(async () => {
      refresh.resolve(json(fixture(32)));
    });

    expect(input).toHaveValue("25");
    expect(screen.getByRole("button", { name: "Save capacity" })).toBeEnabled();
    expect(
      screen.queryByText(
        "Your change was saved. The latest capacity has now been loaded.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit weekly hours for Ana" }),
    ).toHaveTextContent("32 h / week");
    expect(
      mock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(1);
  });

  it("reopens a complete editor after it was closed during a refresh retry", async () => {
    const refresh = deferred<Response>();
    const mock = vi
      .fn()
      .mockResolvedValueOnce(json(fixture()))
      .mockResolvedValueOnce(json({ id: 1, name: "Ana", weekly_hours: 32 }))
      .mockRejectedValueOnce(new Error("Offline"))
      .mockReturnValueOnce(refresh.promise);
    vi.stubGlobal("fetch", mock);
    render(<CapacityGrid from={query.from} to={query.to} />);
    fireEvent.change(await openEditor(), { target: { value: "32" } });
    fireEvent.click(screen.getByRole("button", { name: "Save capacity" }));
    await screen.findByText(/Saved · 32 h\/week. The capacity refresh failed/);

    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
    await act(async () => {
      refresh.resolve(json(fixture(32)));
    });

    expect(await openEditor()).toHaveValue("32");
    expect(screen.getByRole("button", { name: "Save capacity" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("region", { name: "Edit capacity for Ana" }),
    ).not.toBeInTheDocument();
  });

  it("rejects blank hours locally but sends decimal hours without rounding", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(json(fixture()))
      .mockResolvedValueOnce(json({ id: 1, name: "Ana", weekly_hours: 32.75 }))
      .mockResolvedValueOnce(json(fixture(32.75)));
    vi.stubGlobal("fetch", mock);
    render(<CapacityGrid from={query.from} to={query.to} />);
    const input = await openEditor();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save capacity" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Blank is not zero.");
    expect(mock).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: "32.75" } });
    fireEvent.click(screen.getByRole("button", { name: "Save capacity" }));
    await screen.findByText(/Saved · 32.75 h\/week/);
    expect(JSON.parse(mock.mock.calls[1][1].body)).toEqual({
      weekly_hours: 32.75,
    });
  });

  it("retains uncertain outcomes across a check, closing the editor, and navigation", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(json(fixture()))
      .mockRejectedValueOnce(new TypeError("Response lost"))
      .mockImplementation(() => Promise.resolve(json(fixture())));
    vi.stubGlobal("fetch", mock);
    render(<CapacityGrid from={query.from} to={query.to} />);
    fireEvent.change(await openEditor(), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save capacity" }));
    await screen.findByText(
      /We could not confirm whether your change was saved/,
    );
    expect(
      screen.getByRole("button", { name: "Save capacity" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Check current value" }),
    );
    await screen.findByText(/earlier request may still finish/);
    // A new draft matching today's value does not confirm the earlier write of 20.
    fireEvent.change(screen.getByRole("textbox", { name: "Weekly hours for Ana" }), {
      target: { value: "40" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check current value" }));
    await screen.findByText(/earlier request may still finish/);
    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(5));
    await waitFor(() =>
      expect(screen.getByText(/A save is unconfirmed/)).toBeVisible(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review Ana’s change" }),
    );
    expect(
      screen.getByRole("textbox", { name: "Weekly hours for Ana" }),
    ).toHaveValue("40");
    expect(
      mock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(1);
  });

  it("preserves an unconfirmed write when a checked draft fails local validation", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(json(fixture()))
      .mockRejectedValueOnce(new TypeError("Response lost"))
      .mockResolvedValueOnce(json(fixture()));
    vi.stubGlobal("fetch", mock);
    render(<CapacityGrid from={query.from} to={query.to} />);
    const input = await openEditor();
    fireEvent.change(input, { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save capacity" }));
    await screen.findByText(/We could not confirm whether your change was saved/);

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Check current value" }));
    await screen.findByText(/earlier request may still finish/);
    fireEvent.click(screen.getByRole("button", { name: "Save draft again" }));

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/Blank is not zero/)).toBeVisible();
    expect(screen.getByText(/A save is unconfirmed/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Check current value" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
    expect(
      screen.getByRole("button", { name: "Review Ana’s change" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Review Ana’s change" }));
    expect(
      screen.getByRole("textbox", { name: "Weekly hours for Ana" }),
    ).toHaveValue("");
    expect(
      mock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(1);
  });

  it("reconciles the earlier submission when a later write retry is rejected", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(json(fixture()))
      .mockRejectedValueOnce(new TypeError("Response lost"))
      .mockResolvedValueOnce(json(fixture()))
      .mockResolvedValueOnce(json({ error: "This change was rejected." }, 400))
      .mockResolvedValueOnce(json(fixture(20)));
    vi.stubGlobal("fetch", mock);
    render(<CapacityGrid from={query.from} to={query.to} />);
    const input = await openEditor();
    fireEvent.change(input, { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save capacity" }));
    await screen.findByText(/We could not confirm whether your change was saved/);

    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Check current value" }));
    await screen.findByText(/earlier request may still finish/);
    fireEvent.click(screen.getByRole("button", { name: "Save draft again" }));
    await screen.findByText(/This change was rejected/);

    expect(input).toHaveValue("30");
    expect(screen.getByText(/A save is unconfirmed/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Check current value" }));
    await screen.findByText(/earlier submission of 20 hours per week/);
    expect(input).toHaveValue("30");
    expect(screen.queryByText(/A save is unconfirmed/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save capacity" })).toBeEnabled();
    expect(
      mock.mock.calls
        .filter(([, init]) => init?.method === "PATCH")
        .map(([, init]) => JSON.parse(init.body)),
    ).toEqual([{ weekly_hours: 20 }, { weekly_hours: 30 }]);
  });
});

describe("loading and uncertain values", () => {
  it("keeps real week headings and unknown totals while hiding old rows during navigation", async () => {
    const initial = deferred<Response>();
    const next = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockReturnValueOnce(initial.promise)
        .mockReturnValueOnce(next.promise),
    );
    render(<CapacityGrid from={query.from} to={query.to} />);
    expect(screen.getByText("Loading team capacity…")).toBeVisible();
    expect(
      screen.getByRole("columnheader", {
        name: /Dec 29 – Jan 4\s*2025 \/ 2026/,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("region", { name: /Capacity for .* is loading/ }),
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("row", { name: /Ana/ })).not.toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "Entire team summary" });
    expect(within(summary).getAllByText("—")).toHaveLength(4);
    expect(within(summary).queryByText(/^0/)).not.toBeInTheDocument();

    // Editing an unapplied date must not relabel the in-flight request's columns.
    fireEvent.change(screen.getByLabelText("From date"), {
      target: { value: "2026-03-01" },
    });
    expect(
      screen.getByRole("columnheader", { name: /Dec 29 – Jan 4/ }),
    ).toBeVisible();
    await act(async () => initial.resolve(json(fixture())));
    expect(screen.getByRole("row", { name: /Ana/ })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.queryByRole("row", { name: /Ana/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: /Dec 29 – Jan 4/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /Jan 19 – Jan 25\s*2026/ }),
    ).toBeVisible();
    expect(within(summary).getAllByText("—")).toHaveLength(4);
    await act(async () =>
      next.resolve(
        json({
          ...fixture(),
          from: "2026-01-05",
          to: "2026-01-25",
          weeks: [
            { start: "2026-01-05", end: "2026-01-11" },
            { start: "2026-01-12", end: "2026-01-18" },
            { start: "2026-01-19", end: "2026-01-25" },
          ],
        }),
      ),
    );
  });

  it("shows one initial error with one retry and preserves the chosen dates", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        json({ error: "Capacity is temporarily unavailable." }, 500),
      )
      .mockResolvedValueOnce(json(fixture()));
    vi.stubGlobal("fetch", mock);
    render(<CapacityGrid from={query.from} to={query.to} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn’t load capacity for these weeks.",
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(1);
    expect(screen.queryByText("No capacity data loaded")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Retry refresh" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("From date")).toHaveValue(query.from);
    expect(screen.getByLabelText("To date")).toHaveValue(query.to);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("row", { name: /Ana/ });
    expect(mock.mock.calls[0][0]).toBe(mock.mock.calls[1][0]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("qualifies an empty overload filter until a slow or failed refresh recovers", async () => {
    const refresh = deferred<Response>();
    const singlePerson = (weeklyHours: number) => ({
      ...fixture(weeklyHours),
      people: [fixture(weeklyHours).people[0]],
    });
    const mock = vi
      .fn()
      .mockResolvedValueOnce(json(singlePerson(40)))
      .mockResolvedValueOnce(json({ id: 1, name: "Ana", weekly_hours: 48 }))
      .mockReturnValueOnce(refresh.promise)
      .mockResolvedValueOnce(json(singlePerson(48)));
    vi.stubGlobal("fetch", mock);
    render(<CapacityGrid from={query.from} to={query.to} />);
    fireEvent.change(await openEditor(), { target: { value: "48" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Over capacity only" }));
    fireEvent.click(screen.getByRole("button", { name: "Save capacity" }));
    await screen.findByText("Saved · 48 h/week.");
    expect(
      screen.getByRole("heading", {
        name: "No over-capacity matches in the values shown",
      }),
    ).toBeVisible();
    expect(screen.queryByText("✓")).not.toBeInTheDocument();
    expect(screen.queryByText("No one is over capacity")).not.toBeInTheDocument();
    await act(async () => refresh.resolve(json({ error: "Offline" }, 500)));
    expect(
      screen.getByRole("heading", {
        name: "No over-capacity matches in the values shown",
      }),
    ).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Retry refresh" })).toHaveLength(1);
    expect(screen.queryByText("✓")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    expect(
      await screen.findByRole("heading", { name: "No one is over capacity" }),
    ).toBeVisible();
    expect(screen.getByText("✓")).toBeVisible();
    expect(
      mock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(1);
  });

  it("does not give an all-clear for empty results while a save is unconfirmed", async () => {
    const data = { ...fixture(48), people: [fixture(48).people[0]] };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json(data))
        .mockRejectedValueOnce(new TypeError("Response lost")),
    );
    render(<CapacityGrid from={query.from} to={query.to} />);
    fireEvent.change(await openEditor(), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save capacity" }));
    await screen.findByText(/We could not confirm whether your change was saved/);
    fireEvent.click(screen.getByRole("checkbox", { name: "Over capacity only" }));
    expect(
      screen.getByRole("heading", {
        name: "No over-capacity matches in the values shown",
      }),
    ).toBeVisible();
    expect(screen.queryByText("No one is over capacity")).not.toBeInTheDocument();
    expect(screen.queryByText("✓")).not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Weekly hours for Ana" }),
    ).toHaveValue("20");
  });
});

describe("range selection and people", () => {
  it("keeps requested dates stable when switching week presets at the maximum range", async () => {
    const mock = vi.fn().mockImplementation((url: string) => {
      const params = new URL(url, "http://localhost").searchParams;
      const requested = {
        from: params.get("from")!,
        to: params.get("to")!,
        workweek: params.get("workweek") as CapacityQuery["workweek"],
      };
      return Promise.resolve(
        json({ ...normalizeRange(requested), weeks: [], people: [] }),
      );
    });
    vi.stubGlobal("fetch", mock);
    render(<CapacityGrid from="2025-01-01" to="2027-01-01" />);
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
    for (const preset of ["sun-thu", "mon-fri", "sun-thu", "mon-fri"]) {
      fireEvent.change(screen.getByRole("combobox", { name: "Working days" }), {
        target: { value: preset },
      });
      fireEvent.click(screen.getByRole("button", { name: "Apply range" }));
      await waitFor(() =>
        expect(mock.mock.calls.at(-1)?.[0]).toContain(`workweek=${preset}`),
      );
    }
    expect(screen.getByLabelText("From date")).toHaveValue("2025-01-01");
    expect(screen.getByLabelText("To date")).toHaveValue("2027-01-01");
    expect(mock).toHaveBeenCalledTimes(5);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows zero-capacity people and filters across the whole roster before paging", async () => {
    const people = Array.from({ length: 60 }, (_, index) => ({
      id: index + 1,
      name: `Person ${String(index + 1).padStart(2, "0")}`,
      weekly_hours: index === 59 ? 0 : 40,
      allocated_hours: index === 59 ? [0, 20, 0] : [0, 0, 0],
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ ...fixture(), people })),
    );
    render(<CapacityGrid from={query.from} to={query.to} />);
    await screen.findByRole("button", {
      name: "Edit weekly hours for Person 01",
    });
    expect(
      screen.queryByRole("button", { name: "Edit weekly hours for Person 60" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Over capacity only" }),
    );
    const row = screen.getByRole("row", { name: /Person 60/ });
    expect(within(row).getByText("20 h over")).toBeVisible();
    expect(within(row).getAllByText("No capacity")).toHaveLength(2);
    expect(
      screen.getByText(
        "1 of 60 people match. Values show allocated / capacity hours.",
      ),
    ).toBeVisible();
  });
});
