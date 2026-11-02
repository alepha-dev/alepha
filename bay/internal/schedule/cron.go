package schedule

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Cron is a standard five-field expression: minute hour day-of-month month
// day-of-week, each a `*`, a number, a range `a-b`, a step `*/n` or `a-b/n`, or
// a comma list of those. Day-of-week is 0-7 (0 and 7 are Sunday). When both
// day fields are restricted, a day matches either, as in every cron since
// Vixie's.
//
// No names (MON, JAN) and no macros (@daily): `at` says "every day at 03:00"
// more plainly than any of them.
type Cron struct {
	expr                          string
	minute, hour, dom, month, dow uint64
	domStar, dowStar              bool
}

func (c *Cron) String() string { return c.expr }

// ParseCron reads a five-field expression.
func ParseCron(expr string) (*Cron, error) {
	fields := strings.Fields(expr)
	if len(fields) != 5 {
		return nil, fmt.Errorf("cron %q: want 5 fields (minute hour day month weekday), got %d", expr, len(fields))
	}
	c := &Cron{expr: strings.Join(fields, " ")}
	var err error
	specs := []struct {
		field    string
		min, max int
		dst      *uint64
		name     string
	}{
		{fields[0], 0, 59, &c.minute, "minute"},
		{fields[1], 0, 23, &c.hour, "hour"},
		{fields[2], 1, 31, &c.dom, "day of month"},
		{fields[3], 1, 12, &c.month, "month"},
		{fields[4], 0, 7, &c.dow, "day of week"},
	}
	for _, f := range specs {
		if *f.dst, err = parseCronField(f.field, f.min, f.max); err != nil {
			return nil, fmt.Errorf("cron %q, %s: %w", expr, f.name, err)
		}
	}
	if c.dow&(1<<7) != 0 {
		c.dow |= 1
	}
	c.domStar = fields[2] == "*"
	c.dowStar = fields[4] == "*"
	return c, nil
}

func parseCronField(field string, lo, hi int) (uint64, error) {
	var bits uint64
	for _, part := range strings.Split(field, ",") {
		rng, stepS, hasStep := strings.Cut(part, "/")
		step := 1
		if hasStep {
			n, err := strconv.Atoi(stepS)
			if err != nil || n < 1 {
				return 0, fmt.Errorf("bad step %q", stepS)
			}
			step = n
		}
		from, to := lo, hi
		switch {
		case rng == "*":
		case strings.Contains(rng, "-"):
			a, b, _ := strings.Cut(rng, "-")
			x, err1 := strconv.Atoi(a)
			y, err2 := strconv.Atoi(b)
			if err1 != nil || err2 != nil || x > y {
				return 0, fmt.Errorf("bad range %q", rng)
			}
			from, to = x, y
		default:
			x, err := strconv.Atoi(rng)
			if err != nil {
				return 0, fmt.Errorf("bad value %q", rng)
			}
			from = x
			if !hasStep {
				to = x
			}
		}
		if from < lo || to > hi {
			return 0, fmt.Errorf("%q is outside %d-%d", part, lo, hi)
		}
		for v := from; v <= to; v += step {
			bits |= 1 << uint(v)
		}
	}
	return bits, nil
}

func (c *Cron) dayMatches(t time.Time) bool {
	dom := c.dom&(1<<uint(t.Day())) != 0
	dow := c.dow&(1<<uint(t.Weekday())) != 0
	switch {
	case c.domStar && c.dowStar:
		return true
	case c.domStar:
		return dow
	case c.dowStar:
		return dom
	}
	return dom || dow
}

// Next is the first matching minute strictly after t, in t's location. Zero
// when nothing matches within five years (Feb 30th).
func (c *Cron) Next(t time.Time) time.Time {
	loc := t.Location()
	t = t.Truncate(time.Minute).Add(time.Minute)
	limit := t.AddDate(5, 0, 0)
	// Skipping ahead by month, day or hour goes through time.Date, which a
	// daylight-saving change can send backwards; never let it.
	advance := func(next time.Time) time.Time {
		if !next.After(t) {
			return t.Add(time.Minute)
		}
		return next
	}
	for t.Before(limit) {
		if c.month&(1<<uint(t.Month())) == 0 {
			t = advance(time.Date(t.Year(), t.Month()+1, 1, 0, 0, 0, 0, loc))
			continue
		}
		if !c.dayMatches(t) {
			t = advance(time.Date(t.Year(), t.Month(), t.Day()+1, 0, 0, 0, 0, loc))
			continue
		}
		if c.hour&(1<<uint(t.Hour())) == 0 {
			t = advance(time.Date(t.Year(), t.Month(), t.Day(), t.Hour()+1, 0, 0, 0, loc))
			continue
		}
		if c.minute&(1<<uint(t.Minute())) == 0 {
			t = t.Add(time.Minute)
			continue
		}
		return t
	}
	return time.Time{}
}
