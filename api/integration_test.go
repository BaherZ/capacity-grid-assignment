package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Set TEST_DATABASE_URL to run against PostgreSQL. A single connection and
// temporary tables isolate all fixtures and PATCH writes from the seed data.
func TestCapacityAndUpdatesPostgres(t *testing.T) {
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
	defer db.Close()
	_, err = db.Exec(context.Background(), `
CREATE TEMP TABLE people (id integer PRIMARY KEY, name text NOT NULL, weekly_hours numeric NOT NULL);
CREATE TEMP TABLE assignments (person_id integer NOT NULL, start_date date NOT NULL, end_date date NOT NULL, hours_per_day numeric NOT NULL);
INSERT INTO people VALUES (1, 'Ana', 40), (2, 'Eli', 0), (3, 'No assignments', 20), (4, 'Fractional', 12.5);
INSERT INTO assignments VALUES
    (1, '2025-12-29', '2026-01-02', 4),
    (1, '2025-12-29', '2026-01-02', 4),
    (1, '2026-01-03', '2026-01-04', 7),
    (1, '2026-01-01', '2026-01-05', 1),
    (2, '2026-01-05', '2026-01-09', 4);
INSERT INTO assignments SELECT 4, '2026-01-05', '2026-01-09', 0.00625 FROM generate_series(1, 16);
`)
	if err != nil {
		t.Fatal(err)
	}
	s := &server{db: db}
	read := func(query string) capacityResponse {
		t.Helper()
		recorder := httptest.NewRecorder()
		s.handleCapacity(recorder, httptest.NewRequest(http.MethodGet, "/api/capacity?"+query, nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("capacity status %d: %s", recorder.Code, recorder.Body.String())
		}
		if recorder.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("capacity must not be cached")
		}
		var response capacityResponse
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		return response
	}
	for _, test := range []struct {
		calendar string
		from     string
		to       string
		want     [][]float64
	}{
		{"mon-fri", "2025-12-29", "2026-01-11", [][]float64{{42, 1}, {0, 20}, {0, 0}, {0, 0.5}}},
		{"sun-thu", "2025-12-28", "2026-01-10", [][]float64{{33, 9}, {0, 16}, {0, 0}, {0, 0.4}}},
	} {
		t.Run(test.calendar, func(t *testing.T) {
			// The chosen dates omit assignments included by full-week expansion.
			response := read("from=2025-12-31&to=2026-01-06&workweek=" + test.calendar)
			if response.From != test.from || response.To != test.to || len(response.People) != 4 || len(response.Weeks) != 2 {
				t.Fatalf("unexpected response shape: %+v", response)
			}
			for index, person := range response.People {
				if person.ID != index+1 || !reflect.DeepEqual(person.AllocatedHours, test.want[index]) {
					t.Errorf("person %+v: want allocations %v", person, test.want[index])
				}
			}
		})
	}
	patch := func(id, body string) *httptest.ResponseRecorder {
		t.Helper()
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPatch, "/api/people/"+id, strings.NewReader(body))
		request.SetPathValue("id", id)
		s.handleUpdatePerson(recorder, request)
		return recorder
	}
	if response := patch("999", `{"weekly_hours":0}`); response.Code != http.StatusNotFound {
		t.Fatalf("missing person: status %d: %s", response.Code, response.Body.String())
	}
	for _, hours := range []string{"0", "20.01"} {
		response := patch("1", `{"weekly_hours":`+hours+`}`)
		if response.Code != http.StatusOK {
			t.Fatalf("update: status %d: %s", response.Code, response.Body.String())
		}
		var updated personResponse
		if err := json.Unmarshal(response.Body.Bytes(), &updated); err != nil {
			t.Fatal(err)
		}
		capacity := read("from=2025-12-29&to=2026-01-11")
		if updated.ID != 1 || updated.Name != "Ana" || capacity.People[0].WeeklyHours != updated.WeeklyHours || !reflect.DeepEqual(capacity.People[0].AllocatedHours, []float64{42, 1}) {
			t.Fatalf("save changed allocations or returned inconsistent capacity: %+v, %+v", updated, capacity.People[0])
		}
	}
	if response := patch("1", `{"weekly_hours":null}`); response.Code != http.StatusBadRequest {
		t.Fatalf("invalid update status %d", response.Code)
	}
	if got := read("from=2026-01-01&to=2026-01-01").People[0].WeeklyHours; got != 20.01 {
		t.Fatalf("rejected update changed saved hours: %v", got)
	}
}
