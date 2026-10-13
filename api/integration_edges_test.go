package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func isolatedCapacityServer(t *testing.T) *server {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.MaxConns = 1
	db, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	if _, err := db.Exec(context.Background(), `
CREATE TEMP TABLE people (id integer PRIMARY KEY, name text NOT NULL, weekly_hours numeric NOT NULL);
CREATE TEMP TABLE assignments (person_id integer NOT NULL, start_date date NOT NULL, end_date date NOT NULL, hours_per_day numeric NOT NULL);
`); err != nil {
		t.Fatal(err)
	}
	return &server{db: db}
}

func readCapacityForTest(t *testing.T, s *server, query string) capacityResponse {
	t.Helper()
	recorder := httptest.NewRecorder()
	s.handleCapacity(recorder, httptest.NewRequest(http.MethodGet, "/api/capacity?"+query, nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("capacity status %d: %s", recorder.Code, recorder.Body.String())
	}
	var response capacityResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response
}

func TestCapacityAllOverlapBoundariesPostgres(t *testing.T) {
	s := isolatedCapacityServer(t)
	base := time.Date(2024, time.February, 26, 0, 0, 0, 0, time.UTC)
	type assignment struct{ from, to time.Time }
	var assignments []assignment
	batch := &pgx.Batch{}
	// Every start weekday and end weekday occurs, including assignments wholly
	// outside the selected weeks, weekend-only spans, and the leap day.
	for offset := -8; offset <= 20; offset++ {
		for duration := 0; duration <= 14; duration++ {
			from := base.AddDate(0, 0, offset)
			to := from.AddDate(0, 0, duration)
			assignments = append(assignments, assignment{from, to})
			id := len(assignments)
			batch.Queue(`INSERT INTO people VALUES ($1, $2, 40)`, id, fmt.Sprintf("Person %d", id))
			batch.Queue(`INSERT INTO assignments VALUES ($1, $2::date, $3::date, 0.13)`, id, from.Format(dateLayout), to.Format(dateLayout))
		}
	}
	if err := s.db.SendBatch(context.Background(), batch).Close(); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		calendar string
		from     time.Time
	}{
		{"mon-fri", base},
		{"sun-thu", base.AddDate(0, 0, -1)},
	} {
		t.Run(test.calendar, func(t *testing.T) {
			response := readCapacityForTest(t, s, "from=2024-02-29&to=2024-03-05&workweek="+test.calendar)
			if len(response.People) != len(assignments) || len(response.Weeks) != 2 || response.From != test.from.Format(dateLayout) || response.To != test.from.AddDate(0, 0, 13).Format(dateLayout) {
				t.Fatalf("wrong response shape or normalized range: %+v", response)
			}
			seen := make(map[int]bool, len(assignments))
			for _, person := range response.People {
				if person.ID < 1 || person.ID > len(assignments) || seen[person.ID] || len(person.AllocatedHours) != 2 {
					t.Fatalf("person identity or week count is incorrect: %+v", person)
				}
				seen[person.ID] = true
				// Roster order is alphabetical; fixture identity, not row position,
				// determines which independent assignment span to check.
				span := assignments[person.ID-1]
				for week, got := range person.AllocatedHours {
					cents := 0
					// This oracle counts individual working dates, independently of
					// the SQL overlap formula, and keeps arithmetic in integer cents.
					for day := 0; day < 5; day++ {
						date := test.from.AddDate(0, 0, week*7+day)
						if !date.Before(span.from) && !date.After(span.to) {
							cents += 13
						}
					}
					if want := float64(cents) / 100; got != want {
						t.Errorf("person %d, %s–%s, week %d: got %v; want %v", person.ID, span.from.Format(dateLayout), span.to.Format(dateLayout), week, got, want)
					}
				}
			}
			for id := 1; id <= len(assignments); id++ {
				if !seen[id] {
					t.Errorf("person %d is missing from the complete roster", id)
				}
			}
		})
	}
}

func TestCapacityMaximumRangeAndEmptyRosterPostgres(t *testing.T) {
	s := isolatedCapacityServer(t)
	query := "from=2025-12-29&to=2028-01-09"
	empty := readCapacityForTest(t, s, query)
	if empty.People == nil || len(empty.People) != 0 || len(empty.Weeks) != maxCapacityWeeks {
		t.Fatalf("an empty roster must keep the week axis and return an empty array: %+v", empty)
	}
	if _, err := s.db.Exec(context.Background(), `
INSERT INTO people VALUES (1, 'Spanning', 0), (2, 'Unallocated', 168);
INSERT INTO assignments VALUES (1, '2024-01-01', '2029-12-31', 0.13);
`); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{
		query,
		"from=2025-12-28&to=2028-01-08&workweek=sun-thu",
	} {
		response := readCapacityForTest(t, s, query)
		if len(response.Weeks) != maxCapacityWeeks || len(response.People) != 2 {
			t.Fatalf("incorrect maximum-range shape: %+v", response)
		}
		seen := make(map[int]bool, 2)
		for _, person := range response.People {
			if person.ID < 1 || person.ID > 2 || seen[person.ID] || len(person.AllocatedHours) != maxCapacityWeeks {
				t.Fatalf("unexpected person identity or missing weeks: %+v", person)
			}
			seen[person.ID] = true
			want := 0.0
			if person.ID == 1 {
				want = 0.65
			}
			for week, allocated := range person.AllocatedHours {
				if allocated != want {
					t.Errorf("person %d week %d: got %v; want %v", person.ID, week, allocated, want)
				}
			}
		}
	}
}

func TestCanceledDatabaseRequestsPostgres(t *testing.T) {
	s := isolatedCapacityServer(t)
	if _, err := s.db.Exec(context.Background(), `INSERT INTO people VALUES (1, 'Ana', 40)`); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name    string
		method  string
		url     string
		body    string
		handler http.HandlerFunc
		message string
	}{
		{"capacity", http.MethodGet, "/api/capacity?from=2026-01-01&to=2026-01-01", "", s.handleCapacity, "Could not load capacity. Please try again."},
		{"update", http.MethodPatch, "/api/people/1", `{"weekly_hours":20}`, s.handleUpdatePerson, "The save could not be confirmed. Check current values before trying again."},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			request := httptest.NewRequest(test.method, test.url, strings.NewReader(test.body)).WithContext(ctx)
			request.SetPathValue("id", "1")
			recorder := httptest.NewRecorder()
			test.handler(recorder, request)
			if recorder.Code != http.StatusInternalServerError || recorder.Header().Get("Content-Type") != "application/json" || recorder.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("incorrect database-error response: %d, %v, %s", recorder.Code, recorder.Header(), recorder.Body.String())
			}
			var body map[string]string
			if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil || len(body) != 1 || body["error"] != test.message {
				t.Fatalf("unexpected error body: %s, %v", recorder.Body.String(), err)
			}
		})
	}
	if got := readCapacityForTest(t, s, "from=2026-01-01&to=2026-01-01").People[0].WeeklyHours; got != 40 {
		t.Fatalf("already-canceled update changed stored capacity: %v", got)
	}
}
