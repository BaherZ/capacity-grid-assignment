package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

type personResponse struct {
	ID          int     `json:"id"`
	Name        string  `json:"name"`
	WeeklyHours float64 `json:"weekly_hours"`
}

func parseWeeklyHours(reader io.Reader) (string, error) {
	var body struct {
		WeeklyHours json.RawMessage `json:"weekly_hours"`
	}
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		return "", fmt.Errorf("send a JSON object containing only weekly_hours as a number")
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return "", fmt.Errorf("send exactly one JSON object")
	}
	if len(body.WeeklyHours) == 0 || body.WeeklyHours[0] != '-' && (body.WeeklyHours[0] < '0' || body.WeeklyHours[0] > '9') {
		return "", fmt.Errorf("weekly_hours is required and must be a number")
	}
	value := string(body.WeeklyHours)
	// Bound the exponent before exact parsing, so a small request cannot ask
	// math/big to construct an enormous integer such as 1e999999999.
	if index := strings.IndexAny(value, "eE"); index >= 0 {
		exponent, err := strconv.Atoi(value[index+1:])
		if err != nil || exponent < -1000 || exponent > 1000 {
			return "", fmt.Errorf("weekly_hours must be between 0 and 168 with at most two decimal places")
		}
	}
	// Check decimal precision exactly; binary floating-point arithmetic must not
	// reject valid values such as 20.01 or silently round a value with 3 decimals.
	hours, ok := new(big.Rat).SetString(value)
	if !ok || hours.Sign() < 0 || hours.Cmp(big.NewRat(168, 1)) > 0 {
		return "", fmt.Errorf("weekly_hours must be between 0 and 168")
	}
	hundredths := new(big.Rat).Mul(hours, big.NewRat(100, 1))
	if !hundredths.IsInt() {
		return "", fmt.Errorf("weekly_hours must have at most two decimal places")
	}
	return value, nil
}

func (s *server) handleUpdatePerson(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 32)
	if err != nil || id < 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "person id must be a positive integer"})
		return
	}
	hours, err := parseWeeklyHours(http.MaxBytesReader(w, r.Body, 1024))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), databaseTimeout)
	defer cancel()
	var person personResponse
	err = s.db.QueryRow(ctx, `
UPDATE people SET weekly_hours = $2::numeric WHERE id = $1
RETURNING id, name, weekly_hours::double precision`, id, hours).
		Scan(&person.ID, &person.Name, &person.WeeklyHours)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Person not found."})
		return
	}
	if err != nil {
		log.Printf("update person %d: %v", id, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "The save could not be confirmed. Check current values before trying again."})
		return
	}
	writeJSON(w, http.StatusOK, person)
}
