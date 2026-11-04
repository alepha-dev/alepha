package backup

import (
	"context"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/s3/s3test"
)

func TestParseRestoreTime(t *testing.T) {
	paris, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		t.Skip("no tzdata:", err)
	}
	cases := map[string]string{
		"2026-10-30T14:00:00Z":      "2026-10-30T14:00:00Z",
		"2026-10-30T14:00:00+02:00": "2026-10-30T12:00:00Z",
		"20261030T140000Z":          "2026-10-30T14:00:00Z",
		"2026-10-30 14:00":          "2026-10-30T13:00:00Z", // CET after the clocks went back
		"2026-07-30 14:00:30":       "2026-07-30T12:00:30Z", // CEST
		"2026-07-30T14:00":          "2026-07-30T12:00:00Z",
		" 2026-07-30 ":              "2026-07-29T22:00:00Z", // a date is its first moment
	}
	for in, want := range cases {
		got, err := ParseRestoreTime(in, paris)
		if err != nil || got.UTC().Format(time.RFC3339) != want {
			t.Errorf("%q: got %v, %v; want %s", in, got.UTC(), err, want)
		}
	}
	for _, in := range []string{"", "yesterday", "30/10/2026", "2026-13-01"} {
		if _, err := ParseRestoreTime(in, paris); err == nil {
			t.Errorf("%q should not parse", in)
		}
	}
	if got, _ := ParseRestoreTime("2026-07-30 14:00", nil); got.UTC().Hour() != 14 {
		t.Errorf("no zone reads UTC, got %v", got.UTC())
	}
}

func TestBeforeIsTheNewestAtOrBefore(t *testing.T) {
	srv := s3test.New(t)
	seedBackups(srv, "20260801T000000Z", "20260803T000000Z", "20260802T000000Z")
	m := New(srv.Client(t))
	ctx := context.Background()

	for when, want := range map[string]string{
		"2026-08-02T12:00:00Z": "20260802T000000Z",
		"2026-08-02T00:00:00Z": "20260802T000000Z", // at counts
		"2026-09-01T00:00:00Z": "20260803T000000Z",
	} {
		e, ok, err := m.Before(ctx, "lore", "production", at(when))
		if err != nil || !ok || e.Timestamp.Format(timeLayout) != want {
			t.Errorf("before %s: %+v, %v, %v; want %s", when, e, ok, err, want)
		}
	}
	if _, ok, err := m.Before(ctx, "lore", "production", at("2026-07-31T23:59:59Z")); ok || err != nil {
		t.Errorf("before every backup: found=%v err=%v", ok, err)
	}
}
