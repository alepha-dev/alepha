package schedule

import (
	"errors"
	"fmt"
	"hash/fnv"
	"sort"
	"strconv"
	"strings"
	"time"
)

/*
Spec is when a periodic task runs, in one of three shapes:

  - every: an interval counted from the last success ("6h");
  - at: wall-clock times in a timezone ("03:00", "15:00" in Europe/Paris);
  - cron: a five-field cron expression, in the same timezone.

and three refinements, each optional:

  - Jitter spreads instances that share a schedule over a span, by a fixed
    offset derived from the instance's name, so twenty apps set to 03:00 do
    not all VACUUM in the same minute, and an instance's backups stay evenly
    spaced instead of wandering;
  - Window restricts when a due run may start ("02:00-06:00"); a run that
    falls due outside waits for the window to open;
  - MinGap skips a slot that comes too soon after the last success - a backup
    taken before a deploy at 02:55 makes the 03:00 one redundant.

As with Due, the decision is read from the last success, never from a timer:
a slot missed while the process was down is due on the first look after boot,
once, however many were missed.
*/
type Spec struct {
	Every  time.Duration
	At     []int // minutes after midnight, sorted
	Cron   *Cron
	Loc    *time.Location
	Jitter time.Duration
	Window *Window
	MinGap time.Duration
}

// Window is a daily span of wall-clock time, in the Spec's location. From
// after To crosses midnight ("22:00-04:00").
type Window struct {
	From, To int // minutes after midnight
}

func (w Window) String() string { return clock(w.From) + "-" + clock(w.To) }

// Contains reports whether t (already in the window's location) falls inside.
func (w Window) Contains(t time.Time) bool {
	m := t.Hour()*60 + t.Minute()
	if w.From < w.To {
		return m >= w.From && m < w.To
	}
	return m >= w.From || m < w.To
}

// ParseClock reads "HH:MM" (24 h) as minutes after midnight.
func ParseClock(s string) (int, error) {
	h, m, ok := strings.Cut(strings.TrimSpace(s), ":")
	hh, err1 := strconv.Atoi(h)
	mm, err2 := strconv.Atoi(m)
	if !ok || err1 != nil || err2 != nil || len(m) != 2 || hh < 0 || hh > 23 || mm < 0 || mm > 59 {
		return 0, fmt.Errorf("%q is not a time of day (HH:MM, 24 h)", s)
	}
	return hh*60 + mm, nil
}

// ParseWindow reads "HH:MM-HH:MM".
func ParseWindow(s string) (*Window, error) {
	from, to, ok := strings.Cut(s, "-")
	if !ok {
		return nil, fmt.Errorf("%q is not a window (HH:MM-HH:MM)", s)
	}
	f, err := ParseClock(from)
	if err != nil {
		return nil, err
	}
	t, err := ParseClock(to)
	if err != nil {
		return nil, err
	}
	if f == t {
		return nil, fmt.Errorf("window %q is empty", s)
	}
	return &Window{From: f, To: t}, nil
}

func clock(m int) string { return fmt.Sprintf("%02d:%02d", m/60, m%60) }

func (s Spec) loc() *time.Location {
	if s.Loc == nil {
		return time.UTC
	}
	return s.Loc
}

// Valid reports whether the spec names exactly one shape.
func (s Spec) Valid() error {
	n := 0
	if s.Every > 0 {
		n++
	}
	if len(s.At) > 0 {
		n++
	}
	if s.Cron != nil {
		n++
	}
	switch n {
	case 0:
		return errors.New("no schedule: set every, at or cron")
	case 1:
		return nil
	}
	return errors.New("every, at and cron are alternatives: set only one")
}

// slotted reports whether the spec runs at wall-clock slots (at, cron)
// rather than at an interval.
func (s Spec) slotted() bool { return s.Every <= 0 && (len(s.At) > 0 || s.Cron != nil) }

// NextSlot is the first slot strictly after t, for at and cron specs.
func (s Spec) NextSlot(t time.Time) time.Time {
	loc := s.loc()
	if s.Cron != nil {
		return s.Cron.Next(t.In(loc))
	}
	local := t.In(loc)
	for day := 0; day <= 2; day++ {
		d := local.AddDate(0, 0, day)
		for _, m := range s.At {
			c := time.Date(d.Year(), d.Month(), d.Day(), m/60, m%60, 0, 0, loc)
			if c.After(t) {
				return c
			}
		}
	}
	return time.Time{}
}

// Offset is the instance's fixed share of the jitter span.
func (s Spec) Offset(key string) time.Duration {
	if s.Jitter <= 0 {
		return 0
	}
	h := fnv.New64a()
	h.Write([]byte(key))
	return time.Duration(h.Sum64() % uint64(s.Jitter))
}

// NextDue is when the next run falls due, before the window is applied.
// The zero time for a task that never succeeded: it is due now.
func (s Spec) NextDue(last time.Time, key string) time.Time {
	if last.IsZero() {
		return time.Time{}
	}
	if s.slotted() {
		// A slot inside MinGap of the last success is skipped, not delayed:
		// it was, in effect, already taken.
		after := last
		if s.MinGap > 0 {
			after = last.Add(s.MinGap - time.Second)
		}
		next := s.NextSlot(after)
		if next.IsZero() {
			return next
		}
		return next.Add(s.Offset(key))
	}
	gap := s.Every
	if s.MinGap > gap {
		gap = s.MinGap
	}
	offset := s.Offset(key)
	if offset == 0 {
		return last.Add(gap)
	}
	// Anchored, not added: last already carries the previous run's offset,
	// and adding it again each cycle stretched every 6h with a 3h share to a
	// run every 9h. The instance's runs fall on its own grid, gap apart and
	// shifted by its share, the first one past half a gap after the last.
	since := last.Add(gap / 2).Sub(time.Unix(0, 0).Add(offset))
	return time.Unix(0, 0).Add(offset).Add((since/gap + 1) * gap)
}

// Decision is whether a task runs now, and if not, when it next may.
type Decision struct {
	Due bool
	// Next is when it falls due (zero: now, never ran); Opens is when the
	// window next opens, set when a due run is waiting for it.
	Next  time.Time
	Opens time.Time
}

/*
Decide is the scheduler's question, asked every tick.

A task that never succeeded is due at once, window or not: an instance with
no backup at all is the riskiest one on the host, and the window is about
load, not about risk.
*/
func (s Spec) Decide(last time.Time, key string, now time.Time) Decision {
	if s.Valid() != nil {
		return Decision{}
	}
	if last.IsZero() {
		return Decision{Due: true}
	}
	next := s.NextDue(last, key)
	if next.IsZero() || now.Before(next) {
		return Decision{Next: next}
	}
	if s.Window != nil && !s.Window.Contains(now.In(s.loc())) {
		return Decision{Next: next, Opens: s.windowOpens(now)}
	}
	return Decision{Due: true, Next: next}
}

func (s Spec) windowOpens(now time.Time) time.Time {
	local := now.In(s.loc())
	for day := 0; day <= 1; day++ {
		d := local.AddDate(0, 0, day)
		c := time.Date(d.Year(), d.Month(), d.Day(), s.Window.From/60, s.Window.From%60, 0, 0, s.loc())
		if c.After(now) {
			return c
		}
	}
	return time.Time{}
}

/*
Gaps is the shortest and the longest time between two runs.

For every, both are the interval. For at and cron they are measured over the
slots of a reference month, so "03:00 and 15:00" gives 12 h both ways and
"0 3 * * 1" a week. The longest gap is what staleness is judged against; the
shortest is what the minimum interval is enforced on, so "* * * * *" is
refused like "every 1m".
*/
func (s Spec) Gaps() (shortest, longest time.Duration) {
	if s.Every > 0 {
		return s.Every, s.Every
	}
	if !s.slotted() {
		return 0, 0
	}
	start := time.Date(2025, 1, 6, 0, 0, 0, 0, s.loc()).Add(-time.Second) // a Monday
	end := start.AddDate(0, 0, 35)
	var slots []time.Time
	for t := s.NextSlot(start); !t.IsZero() && t.Before(end) && len(slots) < 20000; t = s.NextSlot(t) {
		slots = append(slots, t)
	}
	if len(slots) < 2 {
		// Rarer than monthly: report the span searched, which validation
		// refuses as too long.
		return 32 * 24 * time.Hour, 32 * 24 * time.Hour
	}
	shortest = time.Duration(1<<63 - 1)
	for i := 1; i < len(slots); i++ {
		g := slots[i].Sub(slots[i-1])
		shortest = min(shortest, g)
		longest = max(longest, g)
	}
	return shortest, longest
}

// ParseAt reads wall-clock times, sorted and deduplicated.
func ParseAt(times []string) ([]int, error) {
	seen := map[int]bool{}
	var out []int
	for _, t := range times {
		m, err := ParseClock(t)
		if err != nil {
			return nil, err
		}
		if !seen[m] {
			seen[m] = true
			out = append(out, m)
		}
	}
	sort.Ints(out)
	return out, nil
}
