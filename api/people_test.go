package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWeeklyHoursValidation(t *testing.T) {
	for _, number := range []string{"0", "-0", "40", "168", "20.01", "0.01", "1.2300", "1e2", "123e-2"} {
		t.Run(number, func(t *testing.T) {
			got, err := parseWeeklyHours(strings.NewReader(`{"weekly_hours":` + number + `}`))
			if err != nil || got != number {
				t.Fatalf("got %q, %v; want %q", got, err, number)
			}
		})
	}
	for _, body := range []string{
		``, `{`, `null`, `[]`, `{}`, `{"weekly_hours":null}`, `{"weekly_hours":"40"}`,
		`{"weekly_hours":true}`, `{"weekly_hours":{}}`, `{"weekly_hours":[]}`,
		`{"weekly_hours":-1}`, `{"weekly_hours":168.01}`, `{"weekly_hours":20.001}`, `{"weekly_hours":0.001}`,
		`{"weekly_hours":1e999999999}`, `{"weekly_hours":1e-999999999}`, `{"weekly_hours":1e-1000}`,
		`{"weekly_hours":40,"name":"change"}`, `{"weekly_hours":40} {}`, `{"weekly_hours":40} trailing`,
		`{"weekly_hours":NaN}`, `{"weekly_hours":Infinity}`, `{"weekly_hours":01}`,
	} {
		t.Run(body, func(t *testing.T) {
			if value, err := parseWeeklyHours(strings.NewReader(body)); err == nil {
				t.Fatalf("accepted invalid body as %q", value)
			}
		})
	}
}

func TestInvalidPersonID(t *testing.T) {
	for _, id := range []string{"0", "-1", "2147483648", "person", "1.0", ""} {
		t.Run(id, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPatch, "/api/people/"+id, strings.NewReader(`{"weekly_hours":40}`))
			request.SetPathValue("id", id)
			(&server{}).handleUpdatePerson(recorder, request)
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("got status %d: %s", recorder.Code, recorder.Body.String())
			}
		})
	}
}

func TestOversizeUpdateBody(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPatch, "/api/people/1", strings.NewReader(`{"weekly_hours":`+strings.Repeat(" ", 1024)+`40}`))
	request.SetPathValue("id", "1")
	(&server{}).handleUpdatePerson(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("got status %d: %s", recorder.Code, recorder.Body.String())
	}
}
