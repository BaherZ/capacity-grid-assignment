package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestCapacityRange(t *testing.T) {
	tests := []struct {
		name     string
		query    string
		from     string
		to       string
		workweek string
		weeks    int
	}{
		{"default crosses year", "from=2025-12-31&to=2026-01-02", "2025-12-29", "2026-01-04", "mon-fri", 1},
		{"sunday calendar", "from=2025-12-31&to=2026-01-04&workweek=sun-thu", "2025-12-28", "2026-01-10", "sun-thu", 2},
		{"weekend belongs to prior Monday", "from=2026-01-04&to=2026-01-04&workweek=mon-fri", "2025-12-29", "2026-01-04", "mon-fri", 1},
		{"Sunday starts next week", "from=2026-01-04&to=2026-01-04&workweek=sun-thu", "2026-01-04", "2026-01-10", "sun-thu", 1},
		{"leap day", "from=2024-02-29&to=2024-03-01", "2024-02-26", "2024-03-03", "mon-fri", 1},
		{"daylight saving boundaries", "from=2026-03-28&to=2026-03-30", "2026-03-23", "2026-04-05", "mon-fri", 2},
		{"106 complete weeks", "from=2025-12-29&to=2028-01-09", "2025-12-29", "2028-01-09", "mon-fri", 106},
		{"minimum year", "from=0001-01-01&to=0001-01-01", "0001-01-01", "0001-01-07", "mon-fri", 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			query, _ := url.ParseQuery(tt.query)
			got, err := parseCapacityRange(query)
			if err != nil {
				t.Fatal(err)
			}
			if got.from.Format(dateLayout) != tt.from || got.to.Format(dateLayout) != tt.to || got.workweek != tt.workweek || len(got.weeks) != tt.weeks {
				t.Fatalf("got %s–%s, %s, %d weeks; want %s–%s, %s, %d weeks", got.from.Format(dateLayout), got.to.Format(dateLayout), got.workweek, len(got.weeks), tt.from, tt.to, tt.workweek, tt.weeks)
			}
			if got.weeks[0].Start != tt.from || got.weeks[len(got.weeks)-1].End != tt.to {
				t.Fatalf("week boundaries do not match response range: %+v", got.weeks)
			}
		})
	}
}

func TestInvalidCapacityRequests(t *testing.T) {
	for _, query := range []string{
		"", "from=2026-01-01", "to=2026-01-01", "from=2026-02-29&to=2026-03-01",
		"from=2026-1-01&to=2026-01-01", "from=2026-01-02&to=2026-01-01",
		"from=0000-01-01&to=0000-01-01", "from=0001-01-01&to=0001-01-01&workweek=sun-thu",
		"from=9999-12-31&to=9999-12-31", "from=2025-12-29&to=2028-01-10",
		"from=1900-01-01&to=9999-01-01", "from=2026-01-01T00:00:00Z&to=2026-01-01",
		"from=2026-01-01&to=2026-01-01&workweek=", "from=2026-01-01&to=2026-01-01&workweek=fri-sat",
		"from=2026-01-01&from=2026-01-02&to=2026-01-03", "from=2026-01-01&to=2026-01-01&to=2026-01-02",
		"from=2026-01-01&to=2026-01-01&workweek=mon-fri&workweek=sun-thu",
	} {
		t.Run(query, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			(&server{}).handleCapacity(recorder, httptest.NewRequest(http.MethodGet, "/api/capacity?"+query, nil))
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("got status %d: %s", recorder.Code, recorder.Body.String())
			}
			if recorder.Header().Get("Content-Type") != "application/json" || recorder.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("incorrect response headers: %v", recorder.Header())
			}
		})
	}
}
