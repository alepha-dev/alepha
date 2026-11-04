/*
Package backuppolicy is how often an app is backed up and how many backups are
kept, decided in layers.

	built-in  <  global (bay config backup)  <  app (deploy --backup-policy)  <  operator (bay backup config)

Each layer sets only the fields it cares about and leaves the rest to the one
below. The effective value of every field is reported together with the layer
it came from, because "kept 3 backups" is a fact nobody can act on until they
know who decided it — the app's author, the host's operator, or nobody.

Only the fields Bay enforces are declared. A policy field that is stored but
not acted on is worse than none: whoever set `at: 03:00` would read it back
and believe it. So an unknown field is refused, by name, rather than kept.
*/
package backuppolicy

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	// Timezones are named by apps and operators; the host's zoneinfo may be
	// missing (a minimal VM image) or older than the name.
	_ "time/tzdata"

	"github.com/alepha-dev/bay/internal/schedule"
)

// Policy is one layer. A nil or empty field is "not set here, ask the layer
// below".
type Policy struct {
	Enabled  *bool     `json:"enabled,omitempty"`
	Schedule *Schedule `json:"schedule,omitempty"`
	// Window restricts when a scheduled backup may start, "HH:MM-HH:MM" in
	// the schedule's timezone; "any" lifts a window set below.
	Window string `json:"window,omitempty"`
	// MinGap skips a scheduled slot that comes this soon after the last
	// backup, whatever took it.
	MinGap string `json:"minGap,omitempty"`
	// OnDeploy takes a backup (tagged pre-deploy) before each deploy of an
	// instance that already has data, so a release whose migrations go wrong
	// has its starting point saved.
	OnDeploy  *bool      `json:"onDeploy,omitempty"`
	Retention *Retention `json:"retention,omitempty"`
	// Prune is who deletes old backups: "bay" applies Retention after each
	// backup; "lifecycle" leaves it to the bucket's own expiry rules, for a
	// bucket where Bay's key cannot delete.
	Prune string `json:"prune,omitempty"`
	// Verify is the restore test: how often the newest backup is downloaded
	// and checked as a restore would check it.
	Verify *Verify `json:"verify,omitempty"`
}

// Verify schedules the restore test. Every is a duration, or "off".
type Verify struct {
	Every string `json:"every,omitempty"`
}

// Schedule is when backups are taken: one of Every, At or Cron.
type Schedule struct {
	// Every is the interval between two backups, e.g. "6h", "1d".
	Every string `json:"every,omitempty"`
	// At is wall-clock times, e.g. ["03:00", "15:00"], in Timezone.
	At []string `json:"at,omitempty"`
	// Cron is a five-field expression, in Timezone.
	Cron string `json:"cron,omitempty"`
	// Timezone is an IANA name; it also sets where a day, a week and a month
	// begin for retention. Default UTC.
	Timezone string `json:"timezone,omitempty"`
	// Jitter spreads instances sharing a schedule over this span, by a fixed
	// offset per instance.
	Jitter string `json:"jitter,omitempty"`
}

// Retention is which backups survive pruning. A backup is kept when any rule
// keeps it.
type Retention struct {
	// Keep is the newest N backups. 0 with no other rule keeps everything,
	// which only the operator may choose (see Validate).
	Keep *int `json:"keep,omitempty"`
	// Hourly .. Yearly keep the newest backup of each of the last N hours,
	// days, ISO weeks, months, years that have one.
	Hourly  *int `json:"hourly,omitempty"`
	Daily   *int `json:"daily,omitempty"`
	Weekly  *int `json:"weekly,omitempty"`
	Monthly *int `json:"monthly,omitempty"`
	Yearly  *int `json:"yearly,omitempty"`
	// MaxAge removes backups older than this whatever else would keep them
	// ("180d"); "0" lifts a limit set below.
	MaxAge string `json:"maxAge,omitempty"`
	// KeepPreDeploy is how many of the backups taken before a deploy are
	// kept, apart from the rules above.
	KeepPreDeploy *int `json:"keepPreDeploy,omitempty"`
	// KeepTagged keeps backups given a name (`bay backup --tag`) out of
	// pruning altogether.
	KeepTagged *bool `json:"keepTagged,omitempty"`
}

// Source names the layer a value came from.
type Source string

const (
	BuiltIn  Source = "built-in"
	Global   Source = "global"
	App      Source = "app"
	Operator Source = "operator"
)

const (
	// MinEvery is the shortest interval anyone may ask for. Each backup spawns
	// the app's runtime, VACUUMs and uploads; every five minutes is already a
	// lot on a 2-vCPU host shared by twenty apps.
	MinEvery = 5 * time.Minute
	// MaxEvery bounds the other end: past a month a "schedule" is a backup
	// that is not happening, and staleness (2× the interval) would stay quiet
	// for two months.
	MaxEvery = 31 * 24 * time.Hour
	// MaxAppKeep caps what an app may ask Bay to keep, per rule. The bucket is
	// Bay's and often shared; an app declaring keep 100000 is a bill, not a
	// policy.
	MaxAppKeep = 365
	// MaxKeep caps the operator, against a typo rather than a choice.
	MaxKeep = 100000
	// MaxJitter, MaxMinGap bound the refinements: past them they stop
	// spreading load and start moving the schedule.
	MaxJitter = 6 * time.Hour
	MaxMinGap = 24 * time.Hour
	// MinMaxAge is the shortest age limit: below a day, maxAge is a way to
	// lose every backup to one misread unit.
	MinMaxAge = 24 * time.Hour
	// MaxAt is how many times of day a schedule may list.
	MaxAt = 48

	PruneBay       = "bay"
	PruneLifecycle = "lifecycle"
	// WindowAny lifts a window a lower layer set.
	WindowAny = "any"
	// VerifyOff turns the restore test off.
	VerifyOff = "off"
	// MinVerifyEvery, MaxVerifyEvery bound the restore test: each one
	// downloads a whole backup, and past three months a backup nobody has
	// tried to read is a guess.
	MinVerifyEvery = time.Hour
	MaxVerifyEvery = 90 * 24 * time.Hour
)

// Layer is a policy and who set it.
type Layer struct {
	Source Source
	Policy *Policy
}

// Effective is the resolved policy of one instance, every field set.
type Effective struct {
	Enabled bool
	// Every is the interval for an every schedule, and the longest gap
	// between two slots for at and cron: what staleness is judged against.
	Every    time.Duration
	At       []string
	Cron     string
	Timezone string
	Jitter   time.Duration
	Window   string // "" for none
	MinGap   time.Duration
	OnDeploy bool

	// Keep is the newest N; 0 with no other rule keeps everything.
	Keep                                   int
	Hourly, Daily, Weekly, Monthly, Yearly int
	MaxAge                                 time.Duration // 0: no limit
	KeepPreDeploy                          int
	KeepTagged                             bool
	Prune                                  string
	// VerifyEvery is how often the newest backup is test-restored; 0 is off.
	VerifyEvery time.Duration

	// Sources says which layer decided each field.
	Sources Sources
}

// Sources is the layer behind each effective field. Schedule covers every,
// at and cron together: a layer that names one replaces the shape below.
type Sources struct {
	Enabled       Source `json:"enabled"`
	Schedule      Source `json:"schedule"`
	Timezone      Source `json:"timezone"`
	Jitter        Source `json:"jitter"`
	Window        Source `json:"window"`
	MinGap        Source `json:"minGap"`
	OnDeploy      Source `json:"onDeploy"`
	Keep          Source `json:"keep"`
	Hourly        Source `json:"hourly"`
	Daily         Source `json:"daily"`
	Weekly        Source `json:"weekly"`
	Monthly       Source `json:"monthly"`
	Yearly        Source `json:"yearly"`
	MaxAge        Source `json:"maxAge"`
	KeepPreDeploy Source `json:"keepPreDeploy"`
	KeepTagged    Source `json:"keepTagged"`
	Prune         Source `json:"prune"`
	Verify        Source `json:"verify"`
}

type effectiveJSON struct {
	Enabled       bool     `json:"enabled"`
	Every         string   `json:"every"`
	At            []string `json:"at,omitempty"`
	Cron          string   `json:"cron,omitempty"`
	Timezone      string   `json:"timezone"`
	Jitter        string   `json:"jitter"`
	Window        string   `json:"window,omitempty"`
	MinGap        string   `json:"minGap"`
	OnDeploy      bool     `json:"onDeploy"`
	Keep          int      `json:"keep"`
	Hourly        int      `json:"hourly"`
	Daily         int      `json:"daily"`
	Weekly        int      `json:"weekly"`
	Monthly       int      `json:"monthly"`
	Yearly        int      `json:"yearly"`
	MaxAge        string   `json:"maxAge"`
	KeepPreDeploy int      `json:"keepPreDeploy"`
	KeepTagged    bool     `json:"keepTagged"`
	Prune         string   `json:"prune"`
	VerifyEvery   string   `json:"verifyEvery"`
	Sources       Sources  `json:"source"`
}

// MarshalJSON renders durations the way they are written ("6h", "1d"), not
// in nanoseconds, so the API answers in the same words the CLI accepts.
func (e Effective) MarshalJSON() ([]byte, error) {
	return json.Marshal(effectiveJSON{
		Enabled: e.Enabled, Every: FormatDuration(e.Every), At: e.At, Cron: e.Cron,
		Timezone: e.Timezone, Jitter: FormatDuration(e.Jitter), Window: e.Window,
		MinGap: FormatDuration(e.MinGap), OnDeploy: e.OnDeploy,
		Keep: e.Keep, Hourly: e.Hourly, Daily: e.Daily, Weekly: e.Weekly,
		Monthly: e.Monthly, Yearly: e.Yearly, MaxAge: FormatDuration(e.MaxAge),
		KeepPreDeploy: e.KeepPreDeploy, KeepTagged: e.KeepTagged, Prune: e.Prune,
		VerifyEvery: verifyWord(e.VerifyEvery), Sources: e.Sources,
	})
}

// UnmarshalJSON is the CLI reading what the daemon wrote.
func (e *Effective) UnmarshalJSON(raw []byte) error {
	var w effectiveJSON
	if err := json.Unmarshal(raw, &w); err != nil {
		return err
	}
	dur := func(s string) time.Duration {
		d, _ := ParseDuration(s)
		return d
	}
	*e = Effective{
		Enabled: w.Enabled, Every: dur(w.Every), At: w.At, Cron: w.Cron,
		Timezone: w.Timezone, Jitter: dur(w.Jitter), Window: w.Window,
		MinGap: dur(w.MinGap), OnDeploy: w.OnDeploy,
		Keep: w.Keep, Hourly: w.Hourly, Daily: w.Daily, Weekly: w.Weekly,
		Monthly: w.Monthly, Yearly: w.Yearly, MaxAge: dur(w.MaxAge),
		KeepPreDeploy: w.KeepPreDeploy, KeepTagged: w.KeepTagged, Prune: w.Prune,
		VerifyEvery: dur(w.VerifyEvery), Sources: w.Sources,
	}
	return nil
}

func verifyWord(d time.Duration) string {
	if d <= 0 {
		return VerifyOff
	}
	return FormatDuration(d)
}

// VerifyWords is the restore test as a person says it.
func (e Effective) VerifyWords() string {
	if e.VerifyEvery <= 0 {
		return "restore test off"
	}
	return "restore test every " + FormatDuration(e.VerifyEvery)
}

// KeepsEverything reports whether no rule ever deletes a backup.
func (e Effective) KeepsEverything() bool {
	return e.Prune == PruneLifecycle || (e.Keep == 0 && e.Hourly == 0 && e.Daily == 0 &&
		e.Weekly == 0 && e.Monthly == 0 && e.Yearly == 0 && e.MaxAge == 0)
}

// Location is the policy's timezone, UTC when unset or unknown.
func (e Effective) Location() *time.Location {
	if loc, err := time.LoadLocation(e.Timezone); err == nil && e.Timezone != "" {
		return loc
	}
	return time.UTC
}

/*
Spec is the schedule the scheduler runs.

Jitter is held under half the shortest gap between two runs, so spreading
instances never reorders an instance's own backups.
*/
func (e Effective) Spec() schedule.Spec {
	s := schedule.Spec{Loc: e.Location(), MinGap: e.MinGap}
	switch {
	case e.Cron != "":
		s.Cron, _ = schedule.ParseCron(e.Cron)
	case len(e.At) > 0:
		s.At, _ = schedule.ParseAt(e.At)
	default:
		s.Every = e.Every
	}
	if e.Window != "" {
		s.Window, _ = schedule.ParseWindow(e.Window)
	}
	if shortest, _ := s.Gaps(); e.Jitter > 0 && shortest > 0 {
		s.Jitter = min(e.Jitter, shortest/2)
	}
	return s
}

// ScheduleWords is the schedule as a person says it: "every 6h",
// "at 03:00, 15:00 Europe/Paris", "cron 0 */4 * * * UTC".
func (e Effective) ScheduleWords() string {
	tz := e.Timezone
	if tz == "" {
		tz = "UTC"
	}
	var out string
	switch {
	case e.Cron != "":
		out = "cron " + e.Cron + " " + tz
	case len(e.At) > 0:
		out = "at " + strings.Join(e.At, ", ") + " " + tz
	default:
		out = "every " + FormatDuration(e.Every)
	}
	if e.Window != "" {
		out += ", window " + e.Window
	}
	if e.Jitter > 0 {
		out += ", jitter " + FormatDuration(e.Jitter)
	}
	if e.MinGap > 0 {
		out += ", min gap " + FormatDuration(e.MinGap)
	}
	return out
}

// RetentionWords is retention as a person says it: "keep 14, 7 daily,
// 4 weekly, max age 180d, 5 pre-deploy".
func (e Effective) RetentionWords() string {
	if e.Prune == PruneLifecycle {
		return "pruned by the bucket's lifecycle rules, not by Bay"
	}
	if e.KeepsEverything() {
		return "keep all"
	}
	var parts []string
	if e.Keep > 0 {
		parts = append(parts, "keep "+strconv.Itoa(e.Keep))
	}
	for _, r := range []struct {
		n    int
		word string
	}{{e.Hourly, "hourly"}, {e.Daily, "daily"}, {e.Weekly, "weekly"}, {e.Monthly, "monthly"}, {e.Yearly, "yearly"}} {
		if r.n > 0 {
			parts = append(parts, strconv.Itoa(r.n)+" "+r.word)
		}
	}
	if e.MaxAge > 0 {
		parts = append(parts, "max age "+FormatDuration(e.MaxAge))
	}
	parts = append(parts, strconv.Itoa(e.KeepPreDeploy)+" pre-deploy")
	if e.KeepTagged {
		parts = append(parts, "tagged kept")
	}
	return strings.Join(parts, ", ")
}

// Resolve folds the layers, lowest first, into the effective policy. The
// first layer must set every field (it is the built-in one); a later layer
// overrides only what it sets.
//
// Values are validated on the way in; one that no longer parses (a state
// file edited by hand) is skipped so the layer below still applies.
func Resolve(layers ...Layer) Effective {
	var out Effective
	setInt := func(dst *int, src *Source, v *int, l Source) {
		if v != nil {
			*dst, *src = *v, l
		}
	}
	for _, l := range layers {
		p := l.Policy
		if p == nil {
			continue
		}
		if p.Enabled != nil {
			out.Enabled, out.Sources.Enabled = *p.Enabled, l.Source
		}
		if sc := p.Schedule; sc != nil {
			switch {
			case sc.Every != "":
				if d, err := ParseDuration(sc.Every); err == nil {
					out.Every, out.At, out.Cron, out.Sources.Schedule = d, nil, "", l.Source
				}
			case len(sc.At) > 0:
				if _, err := schedule.ParseAt(sc.At); err == nil {
					out.At, out.Cron, out.Sources.Schedule = slices.Clone(sc.At), "", l.Source
				}
			case sc.Cron != "":
				if _, err := schedule.ParseCron(sc.Cron); err == nil {
					out.Cron, out.At, out.Sources.Schedule = sc.Cron, nil, l.Source
				}
			}
			if sc.Timezone != "" {
				if _, err := time.LoadLocation(sc.Timezone); err == nil {
					out.Timezone, out.Sources.Timezone = sc.Timezone, l.Source
				}
			}
			if sc.Jitter != "" {
				if d, err := ParseDuration(sc.Jitter); err == nil {
					out.Jitter, out.Sources.Jitter = d, l.Source
				}
			}
		}
		switch {
		case p.Window == WindowAny:
			out.Window, out.Sources.Window = "", l.Source
		case p.Window != "":
			if _, err := schedule.ParseWindow(p.Window); err == nil {
				out.Window, out.Sources.Window = p.Window, l.Source
			}
		}
		if p.MinGap != "" {
			if d, err := ParseDuration(p.MinGap); err == nil {
				out.MinGap, out.Sources.MinGap = d, l.Source
			}
		}
		if p.OnDeploy != nil {
			out.OnDeploy, out.Sources.OnDeploy = *p.OnDeploy, l.Source
		}
		if r := p.Retention; r != nil {
			// The app may keep more than the operator's global retention,
			// never less: a deploy is untrusted input, and the history the
			// operator asked for is not its to delete. 0 means "all" for
			// keep and maxAge, "none" for the period counts.
			floored := func(cur int, src Source, v *int, zeroIsAll bool) *int {
				if v == nil || l.Source != App || src != Global {
					return v
				}
				if zeroIsAll && cur == 0 || !(zeroIsAll && *v == 0) && *v < cur {
					return nil
				}
				return v
			}
			setInt(&out.Keep, &out.Sources.Keep, floored(out.Keep, out.Sources.Keep, r.Keep, true), l.Source)
			setInt(&out.Hourly, &out.Sources.Hourly, floored(out.Hourly, out.Sources.Hourly, r.Hourly, false), l.Source)
			setInt(&out.Daily, &out.Sources.Daily, floored(out.Daily, out.Sources.Daily, r.Daily, false), l.Source)
			setInt(&out.Weekly, &out.Sources.Weekly, floored(out.Weekly, out.Sources.Weekly, r.Weekly, false), l.Source)
			setInt(&out.Monthly, &out.Sources.Monthly, floored(out.Monthly, out.Sources.Monthly, r.Monthly, false), l.Source)
			setInt(&out.Yearly, &out.Sources.Yearly, floored(out.Yearly, out.Sources.Yearly, r.Yearly, false), l.Source)
			setInt(&out.KeepPreDeploy, &out.Sources.KeepPreDeploy, floored(out.KeepPreDeploy, out.Sources.KeepPreDeploy, r.KeepPreDeploy, false), l.Source)
			if r.MaxAge != "" {
				if d, err := ParseDuration(r.MaxAge); err == nil {
					hours := int(d / time.Hour)
					if floored(int(out.MaxAge/time.Hour), out.Sources.MaxAge, &hours, true) != nil {
						out.MaxAge, out.Sources.MaxAge = d, l.Source
					}
				}
			}
			if r.KeepTagged != nil && !(l.Source == App && out.Sources.KeepTagged == Global && out.KeepTagged && !*r.KeepTagged) {
				out.KeepTagged, out.Sources.KeepTagged = *r.KeepTagged, l.Source
			}
		}
		if p.Prune == PruneBay || p.Prune == PruneLifecycle {
			out.Prune, out.Sources.Prune = p.Prune, l.Source
		}
		if v := p.Verify; v != nil && v.Every != "" {
			if v.Every == VerifyOff {
				out.VerifyEvery, out.Sources.Verify = 0, l.Source
			} else if d, err := ParseDuration(v.Every); err == nil {
				out.VerifyEvery, out.Sources.Verify = d, l.Source
			}
		}
	}
	// For at and cron, the interval reported (and judged for staleness) is
	// the longest gap between two slots.
	if out.Cron != "" || len(out.At) > 0 {
		if _, longest := out.Spec().Gaps(); longest > 0 {
			out.Every = longest
		}
	}
	return out
}

// supported lists the fields Decode accepts, for its refusal message.
const supported = "enabled, schedule.{every,at,cron,timezone,jitter}, window, minGap, onDeploy, " +
	"retention.{keep,hourly,daily,weekly,monthly,yearly,maxAge,keepPreDeploy,keepTagged}, prune, verify.every"

// Decode reads a policy, refusing fields this Bay does not enforce.
func Decode(raw []byte) (*Policy, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var p Policy
	if err := dec.Decode(&p); err != nil {
		if field, ok := strings.CutPrefix(err.Error(), "json: unknown field "); ok {
			return nil, fmt.Errorf("backup policy: %s is not supported by this Bay (supported: %s)", field, supported)
		}
		return nil, fmt.Errorf("backup policy: %w", err)
	}
	if dec.More() {
		return nil, errors.New("backup policy: trailing data after the JSON object")
	}
	return &p, nil
}

/*
Validate checks a layer's values for the trust its source carries.

The app layer is untrusted input: it arrives with a deploy, written by whoever
builds the app. So it may not ask to keep everything forever, nor more than
MaxAppKeep per rule, nor hand pruning to a bucket lifecycle that may not
exist; and Resolve never lets it keep less than the global layer asks.
Intervals and refinements are bounded for everyone.
*/
func (p *Policy) Validate(source Source) error {
	if p == nil {
		return nil
	}
	if sc := p.Schedule; sc != nil {
		if err := sc.validate(); err != nil {
			return err
		}
	}
	if p.Window != "" && p.Window != WindowAny {
		if _, err := schedule.ParseWindow(p.Window); err != nil {
			return fmt.Errorf("window: %w", err)
		}
	}
	if p.MinGap != "" {
		if err := bounded("minGap", p.MinGap, 0, MaxMinGap); err != nil {
			return err
		}
	}
	if r := p.Retention; r != nil {
		if err := r.validate(source); err != nil {
			return err
		}
	}
	switch p.Prune {
	case "", PruneBay:
	case PruneLifecycle:
		if source == App {
			return errors.New("prune: lifecycle (Bay never deletes) is the operator's choice, not the app's")
		}
	default:
		return fmt.Errorf("prune: %q is not bay or lifecycle", p.Prune)
	}
	if v := p.Verify; v != nil && v.Every != "" && v.Every != VerifyOff {
		if err := bounded("verify.every", v.Every, MinVerifyEvery, MaxVerifyEvery); err != nil {
			return err
		}
	}
	return nil
}

func bounded(name, value string, lo, hi time.Duration) error {
	d, err := ParseDuration(value)
	if err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	if d < lo {
		return fmt.Errorf("%s: %s is shorter than the minimum of %s", name, value, FormatDuration(lo))
	}
	if d > hi {
		return fmt.Errorf("%s: %s is longer than the maximum of %s", name, value, FormatDuration(hi))
	}
	return nil
}

func (sc *Schedule) validate() error {
	shapes := 0
	for _, set := range []bool{sc.Every != "", len(sc.At) > 0, sc.Cron != ""} {
		if set {
			shapes++
		}
	}
	if shapes > 1 {
		return errors.New("schedule: every, at and cron are alternatives; set only one")
	}
	loc := time.UTC
	if sc.Timezone != "" {
		l, err := time.LoadLocation(sc.Timezone)
		if err != nil {
			return fmt.Errorf("schedule.timezone: %q is not an IANA timezone (e.g. Europe/Paris)", sc.Timezone)
		}
		loc = l
	}
	if sc.Jitter != "" {
		if err := bounded("schedule.jitter", sc.Jitter, 0, MaxJitter); err != nil {
			return err
		}
	}
	spec := schedule.Spec{Loc: loc}
	field := "schedule.every"
	switch {
	case sc.Every != "":
		return bounded("schedule.every", sc.Every, MinEvery, MaxEvery)
	case len(sc.At) > 0:
		field = "schedule.at"
		if len(sc.At) > MaxAt {
			return fmt.Errorf("schedule.at: %d times, at most %d", len(sc.At), MaxAt)
		}
		at, err := schedule.ParseAt(sc.At)
		if err != nil {
			return fmt.Errorf("schedule.at: %w", err)
		}
		spec.At = at
	case sc.Cron != "":
		field = "schedule.cron"
		c, err := schedule.ParseCron(sc.Cron)
		if err != nil {
			return fmt.Errorf("schedule.cron: %w", err)
		}
		if c.Next(time.Now()).IsZero() {
			return fmt.Errorf("schedule.cron: %q never runs", sc.Cron)
		}
		spec.Cron = c
	default:
		return nil
	}
	shortest, longest := spec.Gaps()
	if shortest < MinEvery {
		return fmt.Errorf("%s: runs %s apart, shorter than the minimum of %s", field, FormatDuration(shortest), FormatDuration(MinEvery))
	}
	if longest > MaxEvery {
		return fmt.Errorf("%s: leaves more than %s between two backups (the maximum)", field, FormatDuration(MaxEvery))
	}
	return nil
}

func (r *Retention) validate(source Source) error {
	limit := MaxKeep
	if source == App {
		limit = MaxAppKeep
	}
	for _, c := range []struct {
		name string
		v    *int
	}{{"keep", r.Keep}, {"hourly", r.Hourly}, {"daily", r.Daily}, {"weekly", r.Weekly},
		{"monthly", r.Monthly}, {"yearly", r.Yearly}, {"keepPreDeploy", r.KeepPreDeploy}} {
		if c.v == nil {
			continue
		}
		switch n := *c.v; {
		case n < 0:
			return fmt.Errorf("retention.%s: %d is negative", c.name, n)
		case n > limit && source == App:
			return fmt.Errorf("retention.%s: %d is more than an app may ask for (%d)", c.name, n, limit)
		case n > limit:
			return fmt.Errorf("retention.%s: %d is more than %d", c.name, n, limit)
		}
	}
	if source == App && r.Keep != nil && *r.Keep == 0 {
		return errors.New("retention.keep: 0 (keep every backup forever) is the operator's choice, not the app's; declare a count")
	}
	if r.MaxAge != "" && r.MaxAge != "0" {
		if err := bounded("retention.maxAge", r.MaxAge, MinMaxAge, 100*365*24*time.Hour); err != nil {
			return err
		}
	}
	return nil
}

// Empty reports whether the layer sets nothing at all.
func (p *Policy) Empty() bool {
	return p == nil || p.Normalize() == nil
}

// Normalize drops empty sub-objects so a stored layer reads back the way it
// was meant ("nothing set") rather than as `{"schedule":{}}`. Nil when empty.
func (p *Policy) Normalize() *Policy {
	if p == nil {
		return nil
	}
	out := &Policy{Enabled: p.Enabled, Window: p.Window, MinGap: p.MinGap, OnDeploy: p.OnDeploy, Prune: p.Prune}
	if sc := p.Schedule; sc != nil && (sc.Every != "" || len(sc.At) > 0 || sc.Cron != "" || sc.Timezone != "" || sc.Jitter != "") {
		c := *sc
		c.At = slices.Clone(sc.At)
		out.Schedule = &c
	}
	if r := p.Retention; r != nil && *r != (Retention{}) {
		c := *r
		out.Retention = &c
	}
	if v := p.Verify; v != nil && v.Every != "" {
		out.Verify = &Verify{Every: v.Every}
	}
	if *out == (Policy{}) {
		return nil
	}
	return out
}

// ParseDuration accepts Go durations ("90m", "6h") plus whole days ("7d"),
// because a backup interval is naturally said in days and Go has no unit for
// them.
func ParseDuration(s string) (time.Duration, error) {
	s = strings.TrimSpace(s)
	if days, ok := strings.CutSuffix(s, "d"); ok {
		n, err := strconv.Atoi(days)
		if err != nil || n < 0 {
			return 0, fmt.Errorf("%q is not a duration (try 30m, 6h, 1d)", s)
		}
		return time.Duration(n) * 24 * time.Hour, nil
	}
	d, err := time.ParseDuration(s)
	if err != nil || d < 0 {
		return 0, fmt.Errorf("%q is not a duration (try 30m, 6h, 1d)", s)
	}
	return d, nil
}

// FormatDuration writes a duration in the largest whole unit: "1d", "6h",
// "90m". Falls back to Go's own rendering for anything finer.
func FormatDuration(d time.Duration) string {
	switch {
	case d == 0:
		return "0"
	case d%(24*time.Hour) == 0:
		return strconv.FormatInt(int64(d/(24*time.Hour)), 10) + "d"
	case d%time.Hour == 0:
		return strconv.FormatInt(int64(d/time.Hour), 10) + "h"
	case d%time.Minute == 0:
		return strconv.FormatInt(int64(d/time.Minute), 10) + "m"
	}
	return d.String()
}

// Bool and Int are pointer helpers for building layers in code.
func Bool(v bool) *bool { return &v }
func Int(v int) *int    { return &v }
