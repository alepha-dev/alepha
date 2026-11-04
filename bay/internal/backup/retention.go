package backup

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

// TagPreDeploy marks the backup Bay takes just before replacing a release.
// Those are kept in their own pool, so a burst of deploys cannot push the
// daily backups out, nor the daily backups the last good state before a deploy.
const TagPreDeploy = "pre-deploy"

// TagPreRestore marks the backup a restore takes of the data it is about to
// replace. It is an ordinary tagged backup: kept while keepTagged is on.
const TagPreRestore = "pre-restore"

// MaxTagLength keeps a stamp directory readable in a bucket listing.
const MaxTagLength = 40

var tagPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// ValidTag accepts the empty tag, and lowercase words joined by hyphens.
func ValidTag(tag string) error {
	if tag == "" {
		return nil
	}
	if len(tag) > MaxTagLength || !tagPattern.MatchString(tag) {
		return fmt.Errorf("tag %q: use lowercase letters, digits and single hyphens, %d characters at most", tag, MaxTagLength)
	}
	return nil
}

// parseStamp reads a bundle directory name, "<stamp>" or "<stamp>-<tag>".
func parseStamp(dir string) (time.Time, string, error) {
	if len(dir) < len(timeLayout) {
		return time.Time{}, "", fmt.Errorf("not a backup stamp: %s", dir)
	}
	ts, err := time.Parse(timeLayout, dir[:len(timeLayout)])
	if err != nil {
		return time.Time{}, "", err
	}
	rest := dir[len(timeLayout):]
	if rest == "" {
		return ts, "", nil
	}
	tag, ok := strings.CutPrefix(rest, "-")
	if !ok || tag == "" || ValidTag(tag) != nil {
		return time.Time{}, "", fmt.Errorf("not a backup stamp: %s", dir)
	}
	return ts, tag, nil
}

/*
Rules is what retention keeps. Every count is "how many", zero meaning the
rule is off; a backup is kept as soon as one rule wants it.

  - Keep: the newest backups, whatever their age.
  - Hourly … Yearly: the newest backup of each of the last N hours, days, ISO
    weeks, months or years that have one, in Location.
  - MaxAge: a cap over all of the above; nothing older survives, except the
    newest backup (never deleted) and tagged ones.
  - KeepPreDeploy: pre-deploy backups are a pool of their own, its newest
    KeepPreDeploy kept; the rules above do not see them.
  - KeepTagged: backups an operator labelled are never deleted. Off, they
    count as ordinary backups.
*/
type Rules struct {
	Keep, Hourly, Daily, Weekly, Monthly, Yearly int
	MaxAge                                       time.Duration
	KeepPreDeploy                                int
	KeepTagged                                   bool
	Location                                     *time.Location
}

// keepsSomething reports whether the rules name anything to keep; without
// that, "prune" would mean "delete all but the newest".
func (r Rules) keepsSomething() bool {
	return r.Keep > 0 || r.Hourly > 0 || r.Daily > 0 || r.Weekly > 0 || r.Monthly > 0 || r.Yearly > 0
}

func (r Rules) check() error {
	for _, n := range []int{r.Keep, r.Hourly, r.Daily, r.Weekly, r.Monthly, r.Yearly, r.KeepPreDeploy} {
		if n < 0 {
			return fmt.Errorf("retention counts cannot be negative")
		}
	}
	if !r.keepsSomething() {
		return fmt.Errorf("retention keeps nothing in particular: set keep or a period (hourly, daily…)")
	}
	return nil
}

// Decision is the plan for one backup.
type Decision struct {
	Entry Entry
	Keep  bool
	// Reasons say why it is kept ("newest", "daily 2025-01-06"…) or why it
	// goes ("older than 180d", "incomplete upload").
	Reasons []string
	// Incomplete marks a bundle without a manifest.
	Incomplete bool
}

type period struct {
	name  string
	count int
	key   func(time.Time) string
}

/*
PlanRetention decides, for backups listed newest first, which the rules keep.
Pure, so `bay backups --plan` shows exactly what the next prune will do.

Two safety nets sit on top of the rules: the newest complete backup is always
kept, and when the newest is under half the size of the largest of the last
30 days — data/ emptied, a broken migration — the newest backup of normal size
is kept too, so the rotation cannot push the good state out.
*/
func PlanRetention(complete, incomplete []Entry, r Rules, now time.Time) []Decision {
	loc := r.Location
	if loc == nil {
		loc = time.UTC
	}
	out := make([]Decision, len(complete))
	keep := func(i int, reason string) {
		out[i].Keep = true
		out[i].Reasons = append(out[i].Reasons, reason)
	}
	var pool, preDeploy []int
	for i, e := range complete {
		out[i].Entry = e
		switch {
		case e.Tag == TagPreDeploy:
			preDeploy = append(preDeploy, i)
		case e.Tag != "" && r.KeepTagged:
			keep(i, "tagged "+e.Tag)
		default:
			pool = append(pool, i)
		}
	}

	for n, i := range pool {
		if n < r.Keep {
			keep(i, fmt.Sprintf("last %d", r.Keep))
		}
	}
	periods := []period{
		{"hourly", r.Hourly, func(t time.Time) string { return t.Format("2006-01-02 15h") }},
		{"daily", r.Daily, func(t time.Time) string { return t.Format("2006-01-02") }},
		{"weekly", r.Weekly, func(t time.Time) string {
			y, w := t.ISOWeek()
			return fmt.Sprintf("%d-W%02d", y, w)
		}},
		{"monthly", r.Monthly, func(t time.Time) string { return t.Format("2006-01") }},
		{"yearly", r.Yearly, func(t time.Time) string { return t.Format("2006") }},
	}
	for _, p := range periods {
		if p.count <= 0 {
			continue
		}
		seen := map[string]bool{}
		for _, i := range pool {
			k := p.key(complete[i].Timestamp.In(loc))
			if seen[k] {
				continue
			}
			seen[k] = true
			if len(seen) > p.count {
				break
			}
			keep(i, p.name+" "+k)
		}
	}
	for n, i := range preDeploy {
		if n < r.KeepPreDeploy {
			keep(i, fmt.Sprintf("last %d pre-deploy", r.KeepPreDeploy))
		}
	}

	if r.MaxAge > 0 {
		limit := now.Add(-r.MaxAge)
		for i, e := range complete {
			if out[i].Keep && e.Timestamp.Before(limit) && !(e.Tag != "" && e.Tag != TagPreDeploy && r.KeepTagged) {
				out[i].Keep = false
				out[i].Reasons = []string{"older than " + words(r.MaxAge)}
			}
		}
	}

	if len(complete) > 0 {
		if !out[0].Keep {
			out[0].Reasons = nil
		}
		out[0].Keep = true
		out[0].Reasons = append(out[0].Reasons, "newest")
	}
	if j := lastNormalSize(complete, pool, now); j >= 0 {
		if !out[j].Keep {
			out[j].Reasons = nil
		}
		out[j].Keep = true
		out[j].Reasons = append(out[j].Reasons, "last backup of normal size")
	}
	for i := range out {
		if !out[i].Keep && len(out[i].Reasons) == 0 {
			out[i].Reasons = []string{"no rule keeps it"}
		}
	}

	// An incomplete bundle older than every backup kept, and than a day, is a
	// dead upload. A newer one may be a backup still running, here or on
	// another Bay writing the same prefix (a copy moved between estates on a
	// shared bucket): left alone.
	var oldestKept time.Time
	for i := len(out) - 1; i >= 0; i-- {
		if out[i].Keep {
			oldestKept = out[i].Entry.Timestamp
			break
		}
	}
	for _, e := range incomplete {
		d := Decision{Entry: e, Keep: true, Incomplete: true, Reasons: []string{"incomplete, may still be uploading"}}
		if !oldestKept.IsZero() && e.Timestamp.Before(oldestKept) && now.Sub(e.Timestamp) > deadUploadAge {
			d.Keep, d.Reasons = false, []string{"incomplete upload"}
		}
		out = append(out, d)
	}
	return out
}

// deadUploadAge is how old an incomplete bundle must be before retention takes
// it for a dead upload rather than one in progress.
const deadUploadAge = 24 * time.Hour

// shrinkWindow bounds how far back the size guard looks, and so how long it
// holds a backup the rules would delete: a month to notice that data/ shrank,
// after which a deliberate cleanup stops pinning the old, larger backup.
const shrinkWindow = 30 * 24 * time.Hour

/*
lastNormalSize finds, when the newest ordinary backup is under half the size
of the largest one from the last shrinkWindow, the newest backup that was not:
the state worth protecting. -1 when nothing shrank.
*/
func lastNormalSize(complete []Entry, pool []int, now time.Time) int {
	if len(pool) < 2 {
		return -1
	}
	since := now.Add(-shrinkWindow)
	var largest int64
	for _, i := range pool[1:] {
		if e := complete[i]; !e.Timestamp.Before(since) && e.Size > largest {
			largest = e.Size
		}
	}
	if complete[pool[0]].Size*2 >= largest {
		return -1
	}
	for _, i := range pool[1:] {
		if complete[i].Size*2 >= largest {
			return i
		}
	}
	return -1
}

// words writes a duration as an operator would: "180d", "36h", "90m".
func words(d time.Duration) string {
	switch {
	case d%(24*time.Hour) == 0:
		return fmt.Sprintf("%dd", d/(24*time.Hour))
	case d%time.Hour == 0:
		return fmt.Sprintf("%dh", d/time.Hour)
	default:
		return d.Round(time.Minute).String()
	}
}
