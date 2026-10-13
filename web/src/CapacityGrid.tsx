import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  fullDate,
  hours,
  normalizeRange,
  parseWeeklyHours,
  rangeError,
  shiftDate,
  shortDate,
  type CapacityQuery,
  type Person,
  type Workweek,
} from "./capacity";
import { useCapacity } from "./useCapacity";
import { CapacityLoading } from "./CapacityLoading";
import {
  currentWeekRange,
  readView,
  viewURL,
  type CapacityView,
} from "./viewState";

type Props = { from: string; to: string };
type Draft = {
  id: number;
  name: string;
  value: string;
  original: number;
  status: "editing" | "saving" | "rejected" | "saved" | "saved-refresh-failed";
  message: string;
  validation?: string;
  // A rejected retry or invalid draft does not resolve an earlier write.
  unconfirmed?: { submitted: number };
  checked?: boolean;
};

function Arrow({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={direction === "left" ? "M12 5l-5 5 5 5" : "M8 5l5 5-5 5"}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CapacityGrid({ from, to }: Props) {
  const defaults = useRef<CapacityQuery>({ from, to, workweek: "mon-fri" });
  const [view, setView] = useState(() =>
    readView(defaults.current, window.location.search),
  );
  const historyMode = useRef<"push" | "replace" | null>("replace");
  const query = useMemo<CapacityQuery>(
    () => ({
      from: view.from,
      to: view.to,
      workweek: view.workweek,
    }),
    [view.from, view.to, view.workweek],
  );
  const [rangeDraft, setRangeDraft] = useState(query);
  const [validation, setValidation] = useState<string | null>(null);
  const search = view.q;
  const overOnly = view.over;
  const page = view.page - 1;
  const pageSize = view.limit;

  function changeView(change: Partial<CapacityView>, replace = false) {
    historyMode.current = replace ? "replace" : "push";
    setView((previous) => ({ ...previous, ...change }));
  }
  const setQuery = (next: CapacityQuery) => changeView({ ...next, page: 1 });
  const setSearch = (q: string) => changeView({ q, page: 1 }, true);
  const setOverOnly = (over: boolean) => changeView({ over, page: 1 });
  const setPage = (next: number) => changeView({ page: next + 1 });
  const setPageSize = (limit: number) => changeView({ limit, page: 1 });

  useEffect(() => {
    const next = viewURL(view, window.location.href);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (historyMode.current && next !== current) {
      if (historyMode.current === "replace")
        window.history.replaceState(null, "", next);
      else window.history.pushState(null, "", next);
    }
    historyMode.current = null;
  }, [view]);

  useEffect(() => {
    const restore = () => {
      historyMode.current = null;
      const restored = readView(defaults.current, window.location.search);
      setView(restored);
      setRangeDraft({
        from: restored.from,
        to: restored.to,
        workweek: restored.workweek,
      });
      setValidation(null);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [activeEditor, setActiveEditor] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const hoursInput = useRef<HTMLInputElement>(null);
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const tableScroll = useRef<HTMLDivElement>(null);
  const capacity = useCapacity(query);
  const data = capacity.current;
  const effective = normalizeRange(query);
  const editor = activeEditor === null ? null : drafts[activeEditor];
  const unconfirmedDrafts = Object.values(drafts).filter(
    (draft) => draft.unconfirmed !== undefined,
  );

  useEffect(() => {
    if (capacity.readRevision === 0) return;
    // Any successful current read recovers the refresh, including week navigation.
    // Only clear old refresh failures; unsaved and unconfirmed drafts stay intact.
    setDrafts((previous) => {
      const recovered = Object.values(previous).filter(
        (draft) => draft.status === "saved-refresh-failed",
      );
      if (recovered.length === 0) return previous;
      const next = { ...previous };
      for (const draft of recovered) {
        next[draft.id] = {
          ...draft,
          status: "saved",
          message: `Saved · ${hours(draft.original)} h/week.`,
        };
      }
      return next;
    });
  }, [capacity.readRevision]);

  useEffect(() => {
    if (activeEditor !== null) {
      hoursInput.current?.focus();
      hoursInput.current?.select();
    }
  }, [activeEditor]);

  const summary = useMemo(() => {
    const people = data?.people ?? [];
    return {
      capacity: people.reduce((sum, person) => sum + person.weekly_hours, 0),
      allocated: people.reduce(
        (sum, person) =>
          sum +
          person.allocated_hours.reduce((total, value) => total + value, 0),
        0,
      ),
      over: people.filter((person) =>
        person.allocated_hours.some((value) => value > person.weekly_hours),
      ).length,
    };
  }, [data]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (data?.people ?? []).filter(
      (person) =>
        person.name.toLocaleLowerCase().includes(needle) &&
        (!overOnly ||
          person.allocated_hours.some((value) => value > person.weekly_hours)),
    );
  }, [data, search, overOnly]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );

  useEffect(() => {
    if (data && !capacity.loading && currentPage !== page) {
      changeView({ page: currentPage + 1 }, true);
    }
  }, [data, capacity.loading, currentPage, page]);

  useLayoutEffect(() => {
    // Begin each set of people at its first row, keeping the same weeks in view.
    if (tableScroll.current) tableScroll.current.scrollTop = 0;
  }, [currentPage, pageSize, search, overOnly]);

  function applyRange(event: FormEvent) {
    event.preventDefault();
    const error = rangeError(rangeDraft);
    setValidation(error);
    if (!error) {
      setQuery(rangeDraft);
    }
  }

  function moveRange(days: number) {
    const next = {
      ...query,
      from: shiftDate(query.from, days),
      to: shiftDate(query.to, days),
    };
    const error = rangeError(next);
    setValidation(error);
    if (!error) {
      setQuery(next);
      setRangeDraft(next);
    }
  }

  function edit(person: Person, trigger: HTMLButtonElement) {
    editorTrigger.current = trigger;
    setDrafts((previous) => ({
      ...previous,
      [person.id]: previous[person.id] ?? {
        id: person.id,
        name: person.name,
        value: String(person.weekly_hours),
        original: person.weekly_hours,
        status: "editing",
        message: "",
      },
    }));
    setActiveEditor(person.id);
  }

  function updateDraft(id: number, change: Partial<Draft>) {
    setDrafts((previous) =>
      previous[id]
        ? { ...previous, [id]: { ...previous[id], ...change } }
        : previous,
    );
  }

  async function saveHours(event: FormEvent) {
    event.preventDefault();
    if (!editor || capacity.saving) return;
    const parsed = parseWeeklyHours(editor.value);
    if (parsed === null) {
      updateDraft(editor.id, {
        validation:
          "Enter a number from 0 to 168, with up to two decimal places. Blank is not zero.",
      });
      return;
    }
    const id = editor.id;
    updateDraft(id, { status: "saving", message: "", validation: undefined });
    const result = await capacity.save(id, parsed);
    if (result.kind === "saved") {
      const savedDraft: Draft = {
        ...editor,
        status: "saved",
        original: result.person.weekly_hours,
        value: String(result.person.weekly_hours),
        validation: undefined,
        unconfirmed: undefined,
        checked: false,
        message: `Saved · ${hours(result.person.weekly_hours)} h/week.`,
      };
      setDrafts((previous) =>
        previous[id] ? { ...previous, [id]: savedDraft } : previous,
      );

      // Saving is complete. Refresh feedback belongs only to this exact draft;
      // the manager can now edit again, close the editor, or move to other weeks.
      const refreshed = await result.refresh;
      if (refreshed.obsolete) return;
      setDrafts((previous) => {
        if (previous[id] !== savedDraft) return previous;
        return {
          ...previous,
          [id]: {
            ...savedDraft,
            status: refreshed.error ? "saved-refresh-failed" : "saved",
            message: refreshed.error
              ? `${savedDraft.message} The capacity refresh failed; your change is saved.`
              : savedDraft.message,
          },
        };
      });
    } else {
      updateDraft(id, {
        status: result.kind === "rejected" ? "rejected" : "editing",
        unconfirmed:
          result.kind === "unconfirmed"
            ? { submitted: parsed }
            : editor.unconfirmed,
        message:
          result.kind === "rejected" && editor.unconfirmed
            ? `${result.message} Your earlier save is still unconfirmed. Check the current value before saving again.`
            : result.message,
        checked: false,
      });
    }
  }

  async function checkLatest() {
    if (!editor?.unconfirmed || capacity.saving || checking) return;
    const id = editor.id;
    const draft = editor.value;
    const submitted = editor.unconfirmed.submitted;
    setChecking(true);
    const result = await capacity.refresh();
    setChecking(false);
    if (result.data) {
      const person = result.data.people.find((row) => row.id === id);
      if (!person) {
        updateDraft(id, {
          message:
            "This person was not found in the latest roster. Your draft is still here.",
        });
      } else if (person.weekly_hours === submitted) {
        const unchangedDraft = parseWeeklyHours(draft) === submitted;
        updateDraft(id, {
          status: unchangedDraft ? "saved" : "editing",
          original: person.weekly_hours,
          unconfirmed: undefined,
          checked: true,
          message: unchangedDraft
            ? `The current server value is ${hours(person.weekly_hours)} hours per week and matches your draft.`
            : `The current server value matches your earlier submission of ${hours(person.weekly_hours)} hours per week. Your current draft has not been saved.`,
        });
      } else {
        updateDraft(id, {
          checked: true,
          message: `The latest server value is ${hours(person.weekly_hours)} hours per week. Your draft is still ${draft.trim() || "blank"}. The earlier request may still finish; check again before choosing to save your draft again.`,
        });
      }
    } else if (result.error) {
      updateDraft(id, {
        message:
          "The latest value could not be checked. Your draft is preserved, and the earlier save is still unconfirmed.",
      });
    }
  }

  async function retryRefresh() {
    const draft = editor;
    const result = await capacity.refresh();
    if (draft && result.data) {
      setDrafts((previous) => {
        // Refreshing allocations must not mark a newer draft saved or reopen one.
        if (previous[draft.id] !== draft) return previous;
        return {
          ...previous,
          [draft.id]: {
            ...draft,
            status: "saved",
            message:
              "Your change was saved. The latest capacity has now been loaded.",
          },
        };
      });
    }
  }

  function closeEditor() {
    if (!editor || capacity.saving || checking) return;
    // An unconfirmed draft survives dismissing the panel and opening it again.
    if (!editor.unconfirmed) {
      setDrafts((previous) => {
        const next = { ...previous };
        delete next[editor.id];
        return next;
      });
    }
    setActiveEditor(null);
    if (editorTrigger.current?.isConnected) editorTrigger.current.focus();
    else searchInput.current?.focus();
  }

  const isSaved =
    editor?.status === "saved" || editor?.status === "saved-refresh-failed";
  const isUnconfirmed = Boolean(editor?.unconfirmed);
  const readBlocked =
    capacity.loading || Boolean(capacity.error) || unconfirmedDrafts.length > 0;
  const savedPerson = isSaved
    ? data?.people.find((person) => person.id === editor?.id)
    : undefined;
  const savedPersonHidden =
    overOnly &&
    savedPerson &&
    savedPerson.weekly_hours === editor?.original &&
    savedPerson.allocated_hours.every(
      (value) => value <= savedPerson.weekly_hours,
    );
  const unfilteredOverOnly = overOnly && !search.trim();

  return (
    <>
      <section className="range-panel" aria-label="Capacity date range">
        <form className="range-form" onSubmit={applyRange}>
          <label>
            From
            <input
              type="date"
              aria-label="From date"
              value={rangeDraft.from}
              min="0001-01-01"
              max="9999-12-31"
              onChange={(event) =>
                setRangeDraft((previous) => ({
                  ...previous,
                  from: event.target.value,
                }))
              }
              aria-invalid={Boolean(validation)}
              aria-describedby={validation ? "range-error" : undefined}
            />
          </label>
          <span className="range-connector" aria-hidden="true">
            —
          </span>
          <label>
            To
            <input
              type="date"
              aria-label="To date"
              value={rangeDraft.to}
              min="0001-01-01"
              max="9999-12-31"
              onChange={(event) =>
                setRangeDraft((previous) => ({
                  ...previous,
                  to: event.target.value,
                }))
              }
              aria-invalid={Boolean(validation)}
              aria-describedby={validation ? "range-error" : undefined}
            />
          </label>
          <label className="workweek-field">
            Working days
            <select
              value={rangeDraft.workweek}
              onChange={(event) =>
                setRangeDraft((previous) => ({
                  ...previous,
                  workweek: event.target.value as Workweek,
                }))
              }
            >
              <option value="mon-fri">Monday–Friday</option>
              <option value="sun-thu">Sunday–Thursday</option>
            </select>
          </label>
          <button className="button button-primary apply-button" type="submit">
            Apply range
          </button>
        </form>
        {validation && (
          <p id="range-error" className="field-error" role="alert">
            {validation}
          </p>
        )}
        <p className="calendar-note">
          <span aria-hidden="true">ⓘ</span> Whole weeks are shown. The selected
          working days apply to everyone, with matching week starts. Holidays
          and leave are not deducted.
        </p>
      </section>

      <section className="view-heading" aria-label="Selected weeks">
        <div>
          <p className="eyebrow">CAPACITY OVERVIEW</p>
          <h2>
            {fullDate(effective.from)} <span className="date-dash">–</span>{" "}
            {fullDate(effective.to)}
          </h2>
          <p className="view-context">
            {query.workweek === "mon-fri"
              ? "Monday–Friday · Weeks start Monday"
              : "Sunday–Thursday · Weeks start Sunday"}
            {data
              ? ` · ${data.weeks.length} ${data.weeks.length === 1 ? "week" : "weeks"}`
              : ""}
          </p>
        </div>
        <div className="week-navigation">
          <button
            type="button"
            className="button"
            onClick={() => {
              const next = currentWeekRange(query);
              setValidation(null);
              setQuery(next);
              setRangeDraft(next);
            }}
          >
            This week
          </button>
          <button
            type="button"
            className="button"
            disabled={capacity.loading || capacity.saving || checking}
            onClick={() => void capacity.refresh()}
          >
            Refresh
          </button>
          <button
            type="button"
            className="button button-icon"
            aria-label="Previous week"
            onClick={() => moveRange(-7)}
          >
            <Arrow direction="left" />
          </button>
          <span>Move 1 week</span>
          <button
            type="button"
            className="button button-icon"
            aria-label="Next week"
            onClick={() => moveRange(7)}
          >
            <Arrow direction="right" />
          </button>
        </div>
      </section>

      <section
        className={`summary-grid${readBlocked ? " summary-stale" : ""}`}
        aria-label="Entire team summary"
      >
        <div className="summary-card">
          <span className="summary-label">People on the team</span>
          <strong>
            {data ? data.people.length.toLocaleString("en") : "—"}
          </strong>
          <span className="summary-detail">
            Entire roster, including unallocated people
          </span>
        </div>
        <div className="summary-card summary-warning">
          <span className="summary-label">People over capacity</span>
          <strong>
            {data ? summary.over.toLocaleString("en") : "—"}
            <span className="summary-unit">
              {data ? ` / ${data.people.length}` : ""}
            </span>
          </strong>
          <span className="summary-detail">
            In at least one of the selected weeks
          </span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Allocated in this range</span>
          <strong>
            {data ? hours(summary.allocated) : "—"}
            <span className="summary-unit"> h</span>
          </strong>
          <span className="summary-detail">
            Across the entire team and all shown weeks
          </span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Team weekly capacity</span>
          <strong>
            {data ? hours(summary.capacity) : "—"}
            <span className="summary-unit"> h</span>
          </strong>
          <span className="summary-detail">
            Available each full week, across the entire team
          </span>
        </div>
      </section>

      {editor && (
        <section
          className="editor-panel"
          aria-label={`Edit capacity for ${editor.name}`}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !capacity.saving && !checking) {
              event.preventDefault();
              closeEditor();
            }
          }}
        >
          <div className="editor-intro">
            <p className="eyebrow">EDIT WEEKLY CAPACITY</p>
            <h3>
              <bdi>{editor.name}</bdi>
            </h3>
            <p>
              This changes capacity for all past and future weeks.
              <br />{" "}
              Allocations stay the same.
            </p>
          </div>
          <div className="editor-content">
            <form className="editor-form" onSubmit={saveHours}>
              <label>
                Weekly hours
                <input
                  ref={hoursInput}
                  type="text"
                  inputMode="decimal"
                  aria-label={`Weekly hours for ${editor.name}`}
                  aria-describedby={[
                    "hours-guidance",
                    editor.message ? "save-message" : "",
                    editor.validation ? "hours-validation" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  value={editor.value}
                  disabled={capacity.saving || checking}
                  aria-invalid={
                    Boolean(editor.validation) || editor.status === "rejected"
                  }
                  onChange={(event) =>
                    updateDraft(editor.id, {
                      value: event.target.value,
                      status: "editing",
                      validation: undefined,
                      message: isUnconfirmed
                        ? "Your draft has changed. The earlier save is still unconfirmed. Check the current value before saving again."
                        : "",
                      checked: false,
                    })
                  }
                />
              </label>
              <button
                type="submit"
                className="button button-primary"
                disabled={
                  capacity.saving ||
                  checking ||
                  Boolean(isSaved) ||
                  Boolean(isUnconfirmed && !editor.checked)
                }
              >
                {capacity.saving
                  ? "Saving…"
                  : isUnconfirmed && editor.checked
                    ? "Save draft again"
                    : "Save capacity"}
              </button>
              <button
                type="button"
                className="button button-plain"
                onClick={closeEditor}
                disabled={capacity.saving || checking}
              >
                {isSaved || isUnconfirmed ? "Close editor" : "Cancel"}
              </button>
            </form>
            <p id="hours-guidance" className="input-help">
              0–168 hours · Up to 2 decimal places · 0 means no capacity
            </p>
            {editor.validation && (
              <p id="hours-validation" className="field-error" role="alert">
                {editor.validation}
              </p>
            )}
            {editor.message && (
              <div
                className={`save-feedback ${isSaved ? "save-success" : "save-warning"}`}
                role={editor.status === "rejected" ? "alert" : "status"}
              >
                <p id="save-message">{editor.message}</p>
                {savedPersonHidden && (
                  <p>
                    With the shown allocations, {editor.name} is within capacity
                    and is hidden by the over-capacity filter.
                  </p>
                )}
                {isUnconfirmed && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void checkLatest()}
                    disabled={checking || capacity.loading || capacity.saving}
                  >
                    {checking ? "Checking…" : "Check current value"}
                  </button>
                )}
                {editor.status === "saved-refresh-failed" && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void retryRefresh()}
                    disabled={capacity.loading}
                  >
                    Retry refresh
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      <section className="grid-panel" aria-label="Weekly team allocations">
        <div className="grid-toolbar">
          <div className="search-wrap">
            <svg
              width="18"
              height="18"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="8.5"
                cy="8.5"
                r="5.5"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path
                d="m13 13 4 4"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            <input
              ref={searchInput}
              type="search"
              aria-label="Search all people"
              placeholder="Search all people…"
              maxLength={100}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
            />
          </div>
          <label className="over-filter">
            <input
              type="checkbox"
              checked={overOnly}
              onChange={(event) => {
                setOverOnly(event.target.checked);
              }}
            />
            <span>Over capacity only</span>
          </label>
          <div className="grid-legend">
            <span className="legend-dot" /> Over capacity{" "}
            <span className="legend-neutral" /> Within capacity
          </div>
        </div>
        <div className="read-status" aria-live="polite" aria-atomic="true">
          {capacity.loading
            ? data
              ? "Updating capacity… Shown allocations may be out of date."
              : "Loading team capacity…"
            : unconfirmedDrafts.length > 0
              ? "A save is unconfirmed. Shown values may still change; review the unconfirmed change below."
              : capacity.error
                ? ""
                : data
                  ? `${filtered.length.toLocaleString("en")} of ${data.people.length.toLocaleString("en")} people match. Values show allocated / capacity hours.`
                  : ""}
        </div>
        {unconfirmedDrafts.length > 0 && (
          <div className="uncertain-notice">
            <span>
              Unconfirmed{" "}
              {unconfirmedDrafts.length === 1 ? "change" : "changes"}:
            </span>
            {unconfirmedDrafts.map((draft) => (
              <button
                key={draft.id}
                type="button"
                className="text-button"
                disabled={capacity.saving}
                onClick={(event) => {
                  editorTrigger.current = event.currentTarget;
                  setActiveEditor(draft.id);
                }}
              >
                Review {draft.name}’s change
              </button>
            ))}
          </div>
        )}
        {capacity.error && data && (
          <div className="load-error" role="alert">
            <div>
              <strong>Couldn’t update capacity.</strong>
              <p>
                Showing previously loaded allocations with any confirmed
                capacity changes. These values may be out of date.
              </p>
            </div>
            {editor?.status !== "saved-refresh-failed" && (
              <button
                type="button"
                className="button"
                onClick={() => void capacity.refresh()}
              >
                Retry refresh
              </button>
            )}
          </div>
        )}
        {!data ? (
          capacity.loading ? (
            <CapacityLoading from={effective.from} to={effective.to} />
          ) : (
            <div className="empty-state" role="alert">
              <h3>We couldn’t load capacity for these weeks.</h3>
              <p>{capacity.error || "Please try again."}</p>
              <button
                type="button"
                className="button"
                onClick={() => void capacity.refresh()}
              >
                Try again
              </button>
            </div>
          )
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <span className="empty-mark" aria-hidden="true">
              {unfilteredOverOnly && !readBlocked ? "✓" : "⌕"}
            </span>
            <h3>
              {unfilteredOverOnly
                ? readBlocked
                  ? "No over-capacity matches in the values shown"
                  : "No one is over capacity"
                : readBlocked
                  ? "No matches in the values shown"
                  : "No people match your filters"}
            </h3>
            <p>
              {readBlocked
                ? "Shown values may still change. Check the update status before relying on these results."
                : unfilteredOverOnly
                  ? "Across the entire roster, everyone is within capacity for these weeks."
                  : "Try a different name or turn off the capacity filter."}
            </p>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                changeView({ q: "", over: false, page: 1 });
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
            <div
              ref={tableScroll}
              className={`table-scroll${readBlocked ? " table-stale" : ""}`}
              role="region"
              aria-label="Capacity table. Scroll horizontally for more weeks."
              tabIndex={0}
              aria-busy={capacity.loading}
            >
              <table className="capacity-table">
                <caption className="sr-only">
                  Weekly allocations for {fullDate(effective.from)} through{" "}
                  {fullDate(effective.to)}. Each cell shows allocated hours
                  divided by weekly capacity. All people use{" "}
                  {query.workweek === "mon-fri"
                    ? "Monday through Friday"
                    : "Sunday through Thursday"}{" "}
                  as working days. Editing weekly capacity changes all weeks.
                </caption>
                <thead>
                  <tr>
                    <th className="person-column" scope="col">
                      <span>TEAM MEMBER</span>
                      <small>Click weekly hours to edit</small>
                    </th>
                    {data.weeks.map((week) => (
                      <th scope="col" key={week.start}>
                        <span className="week-header">
                          {shortDate(week.start)}{" "}
                          <span>– {shortDate(week.end)}</span>
                        </span>
                        <small>
                          {week.start.slice(0, 4)}
                          {week.end.slice(0, 4) !== week.start.slice(0, 4)
                            ? ` / ${week.end.slice(0, 4)}`
                            : ""}
                        </small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((person) => (
                    <tr key={person.id}>
                      <th scope="row" className="person-column">
                        <div className="person-cell">
                          <span className="avatar" aria-hidden="true">
                            {person.name
                              .split(/\s+/)
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((part) => part[0])
                              .join("")}
                          </span>
                          <div className="person-detail">
                            <span className="person-name" title={person.name}>
                              <bdi>{person.name}</bdi>
                            </span>
                            <button
                              type="button"
                              className="capacity-edit"
                              aria-label={`Edit weekly hours for ${person.name}`}
                              disabled={capacity.saving}
                              onClick={(event) =>
                                edit(person, event.currentTarget)
                              }
                            >
                              {hours(person.weekly_hours)} h / week{" "}
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 16 16"
                                fill="none"
                                aria-hidden="true"
                              >
                                <path
                                  d="m10.5 2.5 3 3-7.5 7.5-4 1 1-4 7.5-7.5Z"
                                  stroke="currentColor"
                                  strokeWidth="1.2"
                                  strokeLinejoin="round"
                                />
                              </svg>
                              {drafts[person.id] &&
                                !["saved", "saved-refresh-failed"].includes(
                                  drafts[person.id].status,
                                ) && (
                                  <span
                                    className="draft-dot"
                                    title="Draft kept"
                                  />
                                )}
                            </button>
                          </div>
                        </div>
                      </th>
                      {data.weeks.map((week, index) => {
                        const allocated = person.allocated_hours[index] ?? 0;
                        const over = allocated > person.weekly_hours;
                        const excess = allocated - person.weekly_hours;
                        const fill =
                          person.weekly_hours > 0
                            ? Math.min(
                                100,
                                (allocated / person.weekly_hours) * 100,
                              )
                            : allocated > 0
                              ? 100
                              : 0;
                        return (
                          <td
                            key={week.start}
                            className={
                              over
                                ? "cell-over"
                                : allocated === 0
                                  ? "cell-empty"
                                  : "cell-within"
                            }
                          >
                            <div className="allocation-value">
                              <strong>{hours(allocated)}</strong>
                              <span> / {hours(person.weekly_hours)} h</span>
                              {over && (
                                <span
                                  className="over-indicator"
                                  aria-hidden="true"
                                >
                                  !
                                </span>
                              )}
                            </div>
                            <div className="allocation-bar" aria-hidden="true">
                              <span style={{ width: `${fill}%` }} />
                            </div>
                            <span
                              className={`allocation-note${over ? " over-note" : ""}`}
                            >
                              {over
                                ? `${hours(excess)} h over`
                                : person.weekly_hours === 0
                                  ? "No capacity"
                                  : allocated === 0
                                    ? "No allocation"
                                    : `${hours(person.weekly_hours - allocated)} h available`}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid-footer">
              <p>
                Showing{" "}
                <strong>
                  {currentPage * pageSize + 1}–
                  {Math.min((currentPage + 1) * pageSize, filtered.length)}
                </strong>{" "}
                of <strong>{filtered.length.toLocaleString("en")}</strong>{" "}
                {filtered.length === data.people.length
                  ? "people"
                  : "matching people"}
              </p>
              <div className="pagination">
                <label>
                  Rows
                  <select
                    aria-label="Rows per page"
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value));
                    }}
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </label>
                <span>
                  Page {currentPage + 1} of {pageCount}
                </span>
                <button
                  type="button"
                  className="button button-icon"
                  aria-label="Previous people page"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <Arrow direction="left" />
                </button>
                <button
                  type="button"
                  className="button button-icon"
                  aria-label="Next people page"
                  disabled={currentPage + 1 >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  <Arrow direction="right" />
                </button>
              </div>
            </div>
          </>
        )}
      </section>
      <p className="grid-footnote">
        Allocation adds up all assignments on working days, including overlaps.
        Capacity is the same in every full week. Figures describe weekly totals;
        daily peaks can differ.
      </p>
    </>
  );
}
