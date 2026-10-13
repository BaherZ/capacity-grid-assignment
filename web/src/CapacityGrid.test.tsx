import "@testing-library/jest-dom/vitest";
import {
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
        /Saved 0 hours per week. The capacity refresh failed/,
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
    await screen.findByText(/Saved 32.75 hours per week/);
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
