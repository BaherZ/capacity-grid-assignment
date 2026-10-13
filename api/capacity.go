package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"time"
)

const (
	dateLayout       = "2006-01-02"
	maxCapacityWeeks = 106
	databaseTimeout  = 10 * time.Second
)

type capacityWeek struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

type capacityPerson struct {
	ID             int       `json:"id"`
	Name           string    `json:"name"`
	WeeklyHours    float64   `json:"weekly_hours"`
	AllocatedHours []float64 `json:"allocated_hours"`
}

type capacityResponse struct {
	From     string           `json:"from"`
	To       string           `json:"to"`
	Workweek string           `json:"workweek"`
	Weeks    []capacityWeek   `json:"weeks"`
	People   []capacityPerson `json:"people"`
}

type capacityRange struct {
	from     time.Time
	to       time.Time
	workweek string
	weeks    []capacityWeek
}

func parseCapacityRange(query url.Values) (capacityRange, error) {
	var result capacityRange
	for _, key := range []string{"from", "to", "workweek"} {
		if len(query[key]) > 1 {
			return result, fmt.Errorf("provide %s only once", key)
		}
	}
	parseDate := func(key string) (time.Time, error) {
		value := query.Get(key)
		date, err := time.Parse(dateLayout, value)
		if err != nil || len(value) != 10 || date.Year() < 1 {
			return time.Time{}, fmt.Errorf("%s must be a valid date in YYYY-MM-DD format (year 0001–9999)", key)
		}
		return date, nil
	}
	from, err := parseDate("from")
	if err != nil {
		return result, err
	}
	to, err := parseDate("to")
	if err != nil {
		return result, err
	}
	if to.Before(from) {
		return result, fmt.Errorf("to must be on or after from")
	}

	workweek := query.Get("workweek")
	if _, specified := query["workweek"]; !specified {
		workweek = "mon-fri"
	}
	startDay := time.Monday
	switch workweek {
	case "mon-fri":
	case "sun-thu":
		startDay = time.Sunday
	default:
		return result, fmt.Errorf("workweek must be mon-fri or sun-thu")
	}
	weekStart := func(date time.Time) time.Time {
		offset := (int(date.Weekday()) - int(startDay) + 7) % 7
		return date.AddDate(0, 0, -offset)
	}
	from = weekStart(from)
	to = weekStart(to).AddDate(0, 0, 6)
	if from.Year() < 1 || to.Year() > 9999 {
		return result, fmt.Errorf("complete weeks must stay within years 0001–9999")
	}
	if to.Sub(from) >= maxCapacityWeeks*7*24*time.Hour {
		return result, fmt.Errorf("select at most %d complete weeks", maxCapacityWeeks)
	}
	weeks := make([]capacityWeek, 0, int(to.Sub(from)/(7*24*time.Hour))+1)
	for start := from; !start.After(to); start = start.AddDate(0, 0, 7) {
		weeks = append(weeks, capacityWeek{
			Start: start.Format(dateLayout),
			End:   start.AddDate(0, 0, 6).Format(dateLayout),
		})
	}
	return capacityRange{from: from, to: to, workweek: workweek, weeks: weeks}, nil
}

// Weeks are complete seven-day periods. The first five days are working days
// for either supported calendar; weekly capacity is never prorated.
// Keep scoped_assignments inline so PostgreSQL can use the date index before
// aggregating. NUMERIC multiplication and SUM preserve fractional seed rows.
// The fixed PostgreSQL image includes language-neutral ICU ordering, so accented
// names sort alphabetically. ID breaks name ties and keeps each person together.
const capacityQuery = `
WITH weeks AS MATERIALIZED (
    SELECT $1::date + n * 7 AS week_start,
           $1::date + n * 7 + 4 AS work_end
    FROM generate_series(0, ($2::date - $1::date) / 7) n
), scoped_assignments AS NOT MATERIALIZED (
    SELECT person_id, start_date, end_date, hours_per_day
    FROM assignments
    WHERE start_date <= $2::date AND end_date >= $1::date
), totals AS (
    SELECT a.person_id, w.week_start,
           sum(a.hours_per_day *
               (least(a.end_date, w.work_end) - greatest(a.start_date, w.week_start) + 1)) AS allocated
    FROM scoped_assignments a
    JOIN weeks w ON a.start_date <= w.work_end AND a.end_date >= w.week_start
    GROUP BY a.person_id, w.week_start
)
SELECT p.id, p.name, p.weekly_hours::double precision,
       coalesce(t.allocated, 0)::double precision
FROM people p CROSS JOIN weeks w
LEFT JOIN totals t ON t.person_id = p.id AND t.week_start = w.week_start
ORDER BY p.name COLLATE "und-x-icu", p.id, w.week_start
`

func (s *server) handleCapacity(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	rangeInfo, err := parseCapacityRange(r.URL.Query())
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), databaseTimeout)
	defer cancel()
	rows, err := s.db.Query(ctx, capacityQuery, rangeInfo.from.Format(dateLayout), rangeInfo.to.Format(dateLayout))
	if err != nil {
		log.Printf("capacity query: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not load capacity. Please try again."})
		return
	}
	defer rows.Close()
	response := capacityResponse{
		From:     rangeInfo.from.Format(dateLayout),
		To:       rangeInfo.to.Format(dateLayout),
		Workweek: rangeInfo.workweek,
		Weeks:    rangeInfo.weeks,
		People:   make([]capacityPerson, 0),
	}
	for rows.Next() {
		var person capacityPerson
		var allocated float64
		if err := rows.Scan(&person.ID, &person.Name, &person.WeeklyHours, &allocated); err != nil {
			log.Printf("capacity scan: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not load capacity. Please try again."})
			return
		}
		last := len(response.People) - 1
		if last < 0 || response.People[last].ID != person.ID {
			person.AllocatedHours = make([]float64, 0, len(rangeInfo.weeks))
			response.People = append(response.People, person)
			last++
		}
		response.People[last].AllocatedHours = append(response.People[last].AllocatedHours, allocated)
	}
	if err := rows.Err(); err != nil {
		log.Printf("capacity rows: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not load capacity. Please try again."})
		return
	}
	writeJSON(w, http.StatusOK, response)
}
