package schedule

import (
	"testing"
	"time"
)

func paris(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		t.Fatal(err)
	}
	return loc
}

func mustCron(t *testing.T, expr string) *Cron {
	t.Helper()
	c, err := ParseCron(expr)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestCronNext(t *testing.T) {
	cases := []struct {
		expr, after, want string
	}{
		{"0 */4 * * *", "2026-11-02T01:30:00Z", "2026-11-02T04:00:00Z"},
		{"30 3 * * *", "2026-11-02T03:30:00Z", "2026-11-03T03:30:00Z"},
		{"0 3 * * 1", "2026-11-02T04:00:00Z", "2026-11-09T03:00:00Z"}, // 2 Nov 2026 is a Monday
		{"0 3 * * 7", "2026-11-02T04:00:00Z", "2026-11-08T03:00:00Z"}, // 7 is Sunday
		{"15,45 9-10 * * *", "2026-11-02T09:20:00Z", "2026-11-02T09:45:00Z"},
		{"0 0 1 * *", "2026-11-02T00:00:00Z", "2026-12-01T00:00:00Z"},
		{"0 0 13 * 5", "2026-11-02T00:00:00Z", "2026-11-06T00:00:00Z"}, // Friday OR the 13th
	}
	for _, c := range cases {
		got := mustCron(t, c.expr).Next(at(c.after))
		if !got.Equal(at(c.want)) {
			t.Errorf("%q after %s = %s, want %s", c.expr, c.after, got.Format(time.RFC3339), c.want)
		}
	}
	if !mustCron(t, "0 0 30 2 *").Next(at("2026-01-01T00:00:00Z")).IsZero() {
		t.Error("30 February must never match")
	}
	for _, bad := range []string{"* * * *", "60 * * * *", "* 24 * * *", "*/0 * * * *", "5-1 * * * *", "MON * * * *"} {
		if _, err := ParseCron(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestCronCrossesDaylightSaving(t *testing.T) {
	loc := paris(t)
	c := mustCron(t, "30 2 * * *")
	// 29 March 2026: Paris skips 02:00-03:00. The next run is still found,
	// and the search never goes backwards.
	after := time.Date(2026, 3, 28, 12, 0, 0, 0, loc)
	got := c.Next(after)
	if got.IsZero() || !got.After(after) {
		t.Fatalf("next = %v", got)
	}
	// 25 October 2026: 02:00-03:00 happens twice.
	after = time.Date(2026, 10, 25, 0, 0, 0, 0, loc)
	for i, t0 := 0, after; i < 5; i++ {
		n := c.Next(t0)
		if !n.After(t0) {
			t.Fatalf("went backwards: %v -> %v", t0, n)
		}
		t0 = n
	}
}

func TestAtSlotsInTimezone(t *testing.T) {
	loc := paris(t)
	at3, _ := ParseAt([]string{"15:00", "03:00", "03:00"})
	s := Spec{At: at3, Loc: loc}
	if len(s.At) != 2 {
		t.Fatalf("at = %v", s.At)
	}
	// 10:00 Paris (09:00 UTC in winter) -> 15:00 Paris.
	got := s.NextSlot(at("2026-11-02T09:00:00Z"))
	if want := time.Date(2026, 11, 2, 15, 0, 0, 0, loc); !got.Equal(want) {
		t.Fatalf("next = %v, want %v", got, want)
	}
	if short, long := s.Gaps(); short != 12*time.Hour || long != 12*time.Hour {
		t.Fatalf("gaps = %v %v", short, long)
	}
}

func TestDecide(t *testing.T) {
	at3, _ := ParseAt([]string{"03:00"})
	daily := Spec{At: at3}

	if d := daily.Decide(time.Time{}, "a", at("2026-11-02T12:00:00Z")); !d.Due {
		t.Error("never backed up must be due at once")
	}
	last := at("2026-11-02T03:00:30Z")
	if d := daily.Decide(last, "a", at("2026-11-02T12:00:00Z")); d.Due || !d.Next.Equal(at("2026-11-03T03:00:00Z")) {
		t.Errorf("decision = %+v", d)
	}
	// Bay down for three days: one catch-up run, not three.
	now := at("2026-11-05T12:00:00Z")
	if d := daily.Decide(last, "a", now); !d.Due {
		t.Error("missed slot must be caught up")
	}
	if d := daily.Decide(now, "a", now.Add(time.Minute)); d.Due {
		t.Error("caught up once, then waits for the next slot")
	}

	// A pre-deploy backup at 02:55 makes the 03:00 slot redundant.
	gap := Spec{At: at3, MinGap: 15 * time.Minute}
	if d := gap.Decide(at("2026-11-02T02:55:00Z"), "a", at("2026-11-02T03:01:00Z")); d.Due ||
		!d.Next.Equal(at("2026-11-03T03:00:00Z")) {
		t.Errorf("min gap: %+v", d)
	}

	// Due outside the window waits for it to open.
	w, _ := ParseWindow("02:00-06:00")
	every := Spec{Every: 6 * time.Hour, Window: w}
	d := every.Decide(at("2026-11-02T00:00:00Z"), "a", at("2026-11-02T10:00:00Z"))
	if d.Due || !d.Opens.Equal(at("2026-11-03T02:00:00Z")) {
		t.Errorf("window: %+v", d)
	}
	if d := every.Decide(at("2026-11-02T00:00:00Z"), "a", at("2026-11-03T02:01:00Z")); !d.Due {
		t.Errorf("inside window: %+v", d)
	}
	night, _ := ParseWindow("22:00-04:00")
	if !night.Contains(at("2026-11-02T23:00:00Z")) || !night.Contains(at("2026-11-02T03:59:00Z")) || night.Contains(at("2026-11-02T04:00:00Z")) {
		t.Error("window across midnight")
	}
}

func TestJitterIsFixedPerInstance(t *testing.T) {
	s := Spec{Every: 6 * time.Hour, Jitter: 10 * time.Minute}
	a1, a2, b := s.Offset("app-a"), s.Offset("app-a"), s.Offset("app-b")
	if a1 != a2 || a1 < 0 || a1 >= 10*time.Minute || b >= 10*time.Minute {
		t.Fatalf("offsets %v %v %v", a1, a2, b)
	}
	last := at("2026-11-02T00:00:00Z")
	if got := s.NextDue(last, "app-a"); !got.Equal(last.Add(6*time.Hour + a1)) {
		t.Fatalf("next = %v", got)
	}
}

func TestGaps(t *testing.T) {
	cases := []struct {
		spec        Spec
		short, long time.Duration
	}{
		{Spec{Every: 6 * time.Hour}, 6 * time.Hour, 6 * time.Hour},
		{Spec{Cron: mustCron(t, "0 */4 * * *")}, 4 * time.Hour, 4 * time.Hour},
		{Spec{Cron: mustCron(t, "0 3 * * 1")}, 7 * day, 7 * day},
		{Spec{Cron: mustCron(t, "0 3,4 * * *")}, time.Hour, 23 * time.Hour},
		{Spec{Cron: mustCron(t, "0 0 1 1 *")}, 32 * day, 32 * day}, // yearly: reported as too long
	}
	for _, c := range cases {
		short, long := c.spec.Gaps()
		if short != c.short || long != c.long {
			t.Errorf("%+v: gaps %v/%v, want %v/%v", c.spec, short, long, c.short, c.long)
		}
	}
	if err := (Spec{Every: time.Hour, Cron: mustCron(t, "* * * * *")}).Valid(); err == nil {
		t.Error("two shapes accepted")
	}
}

func TestParseClockAndWindow(t *testing.T) {
	for _, bad := range []string{"3:00x", "24:00", "03:60", "03:5", "noon"} {
		if _, err := ParseClock(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
	for _, bad := range []string{"02:00", "02:00-02:00", "02:00-25:00"} {
		if _, err := ParseWindow(bad); err == nil {
			t.Errorf("window %q accepted", bad)
		}
	}
}
