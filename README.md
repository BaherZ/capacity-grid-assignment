# Capacity view

Managers need to see who is over-committed before the week starts, not after. This is a
small slice of that: allocation against capacity, per person, per week.

This capacity view will be one component of a team overview page, alongside a timeline
of the team's logged time. For this assignment, build only the capacity view. In
production this page serves rosters of a few thousand people and up to two years of
history. The seed is smaller. Design for the real one, and write down what you deferred.

Budget about ninety minutes. The scaffold runs already — `make up` gives you a working
database, a working API, and a working dev server. Three things are stubbed out and yours
to build.
You do not need Go, Node.js, or Postgres installed locally.

Spend the time where a senior frontend engineer would: the editing flow, what the manager
sees while things load, fail, or arrive late, and keeping the grid correct after a save.
The query should be sound and scoped, not clever.

## Requirements

- Docker with Docker Compose v2
- Make
- Ports 3000 and 8080 available

## Running it

From the repository root:

```bash
make up
```

Web on http://localhost:3000, API on http://localhost:8080.
`GET /api/health` works today and tells you the database is seeded.

`make up` stays in the foreground. Leave it running while you work and press `Ctrl-C` to
stop it. Frontend changes reload automatically. After a backend change, stop and run
`make up` again so the API is rebuilt.

Useful commands:

```bash
make down   # stop and remove the containers
make reset  # wipe the database and re-seed it
make logs   # follow API logs
make psql   # open a Postgres shell
```

## What to build

1. **`GET /api/capacity?from=&to=`** in `api/capacity.go` — for every person and every
   week in the range, how many hours they're allocated and how much capacity they have.
2. **`CapacityGrid`** in `web/src/CapacityGrid.tsx` — people down the side, weeks across
   the top, over-allocation obvious at a glance. Users should be able to navigate
   backward and forward by week and choose a date range from the UI.
3. **Editing capacity** — a manager can change someone's weekly hours from the grid.
   `PATCH /api/people/{id}` is stubbed in `api/people.go`. After saving, the numbers
   on screen must be correct without a full page reload — how they get there (refetch
   the range, patch what you already have, something optimistic) is a decision we'll
   ask about, so write it down. Saves can fail; what the manager sees when one does is
   part of the task.

The JSON shape between them is undefined on purpose. It's your API; design it.

## The data

`db/schema.sql` and `db/seed.sql` hold the team and their assignments. Read them.
They're fixed input — don't edit them.

## Ground rules

- **Use AI tools.** We do, all day. This task assumes it.
- **Use whatever dependencies help.** The API already includes `sqlx`, which we use in
  Focus API, but using it is optional.
- **Don't touch the run environment** — Compose files, Dockerfiles, the Makefile, the
  schema, or the seed. We rebuild submissions with our own copies of those, so changes
  there are lost anyway.
- **Commit as you go** on a feature branch, and don't squash. The history is useful to us.
- **Vitest is installed.** `docker compose exec web npm test` runs it. A test or two around
  the parts you'd be nervous to change is worth more to us than a full suite.

## When you're done

**Start it, open it, and look at the numbers.** Do they say what you expect? If something
looks off, either fix it or write down in `DECISIONS.md` that you saw it and why you left
it. Both are fine answers. Not looking is the one thing that isn't.

Then fill in `DECISIONS.md` — it's short, and it's the first thing we read.

## How we read this

We spend about ten minutes per submission, on:

- `DECISIONS.md`, in your words
- `.notes/worklog.md`, including decisions or verification that did not make the final summary
- The running grid, and whether the numbers hold up
- The grid as a manager experiences it: loading, editing, a failed save
- The API and query design, and how the view behaves after an edit
- The diff, as a piece of code someone else has to maintain
- Your commit history

Then we talk about it for an hour, live, and extend it together. Come ready to explain
what you decided and why — that conversation is the real point of this exercise, and it's
much easier when the notes are honest about what you didn't get to.

## Capacity view behavior

- Date selections include every intersecting **complete week**. The displayed range
  shows the effective boundaries. Previous/next moves the selection seven days.
- The workweek preset applies to everyone in this view: **Monday–Friday** uses
  Monday-start weeks; **Sunday–Thursday** uses Sunday-start weeks. Assignment start
  and end dates are inclusive, and only the preset's five working days contribute.
  There is no holiday, leave, or individual working-pattern data in the scaffold.
- All assignment rows contribute, including rows with identical-looking values.
  Allocation is planned work, not logged time. The warning compares weekly totals.
- Weekly hours are a person's capacity for every displayed week. Editing them changes
  the baseline for past and future weeks; it does not change assignments. Zero is
  valid. The editor accepts 0–168 hours with up to two decimal places.
- Date ranges can cover up to 106 complete weeks, including any two-year span.
  Search, the over-capacity filter, and summary figures use the full loaded roster;
  pagination only limits the rows rendered at once.

### API contract

`GET /api/capacity?from=2025-12-29&to=2026-01-16&workweek=mon-fri`
returns the effective `from`/`to`, selected `workweek`, shared `weeks` containing
`start`/`end` dates, and every person with `id`, `name`, `weekly_hours`, and an
`allocated_hours` array in exactly the same order as `weeks`. `weekly_hours` is
the capacity for each complete week. This keeps names, dates, and constant capacity
from being repeated in every cell. Omitting `workweek` selects `mon-fri`.

`PATCH /api/people/{id}` accepts `{"weekly_hours":32.5}` and returns the saved
`id`, `name`, and `weekly_hours`. Errors use `{"error":"message"}` with 400 for
invalid input, 404 for an unknown person, and 500 for database failures. Reads bypass
HTTP caching. A lost save response is treated as an unconfirmed outcome; a failed
refresh after a confirmed save does not invite a second write.

Save confirmation appears as soon as PATCH succeeds. Its returned capacity updates
the grid and team summary together, while the allocation refresh runs separately.
Loading new weeks shows placeholders under their actual dates. Existing values stay
readable during refresh, with uncertainty stated in both status and empty results.

The editing flow protects against obsolete reads and overlapping writes in this
view. Concurrent edits from separate browsers use last-write-wins; the fixed schema
has no capacity history or revision field.

### Checks

With the standard Compose stack running:

```bash
docker compose exec web npm test
docker compose exec web npm run build
docker compose exec api sh -c 'TEST_DATABASE_URL="$DATABASE_URL" go test ./...'
```

The API image includes the Go toolchain and source, so no local installation is
needed. Rebuild the API image after changing backend code or tests. The PostgreSQL
test uses connection-local temporary tables, leaving the seeded data intact.
