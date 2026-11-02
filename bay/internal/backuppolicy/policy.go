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
	"strconv"
	"strings"
	"time"
)

// Policy is one layer. A nil field is "not set here, ask the layer below".
type Policy struct {
	Enabled   *bool      `json:"enabled,omitempty"`
	Schedule  *Schedule  `json:"schedule,omitempty"`
	Retention *Retention `json:"retention,omitempty"`
}

// Schedule is when backups are taken.
type Schedule struct {
	// Every is the interval between two scheduled backups, e.g. "6h", "1d".
	// Empty is unset.
	Every string `json:"every,omitempty"`
}

// Retention is how many backups survive pruning.
type Retention struct {
	// Keep is how many backups to retain per instance. 0 keeps everything,
	// which only the operator may choose (see Validate).
	Keep *int `json:"keep,omitempty"`
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
	// MaxAppKeep caps what an app may ask Bay to keep. The bucket is Bay's and
	// often shared; an app declaring keep 100000 is a bill, not a policy.
	MaxAppKeep = 365
	// MaxKeep caps the operator, against a typo rather than a choice.
	MaxKeep = 100000
)

// Layer is a policy and who set it.
type Layer struct {
	Source Source
	Policy *Policy
}

// Effective is the resolved policy of one instance, every field set.
type Effective struct {
	Enabled bool
	Every   time.Duration
	// Keep is how many backups survive pruning; 0 keeps them all.
	Keep int
	// Sources says which layer decided each field.
	Sources Sources
}

// Sources is the layer behind each effective field.
type Sources struct {
	Enabled Source `json:"enabled"`
	Every   Source `json:"every"`
	Keep    Source `json:"keep"`
}

type effectiveJSON struct {
	Enabled bool    `json:"enabled"`
	Every   string  `json:"every"`
	Keep    int     `json:"keep"`
	Sources Sources `json:"source"`
}

// MarshalJSON renders Every the way it is written ("6h", "1d"), not in
// nanoseconds, so the API answers in the same words the CLI accepts.
func (e Effective) MarshalJSON() ([]byte, error) {
	return json.Marshal(effectiveJSON{e.Enabled, FormatDuration(e.Every), e.Keep, e.Sources})
}

// UnmarshalJSON is the CLI reading what the daemon wrote.
func (e *Effective) UnmarshalJSON(raw []byte) error {
	var w effectiveJSON
	if err := json.Unmarshal(raw, &w); err != nil {
		return err
	}
	every, err := ParseDuration(w.Every)
	if err != nil && w.Every != "" && w.Every != "0" {
		return err
	}
	*e = Effective{Enabled: w.Enabled, Every: every, Keep: w.Keep, Sources: w.Sources}
	return nil
}

// Resolve folds the layers, lowest first, into the effective policy. The
// first layer must set every field (it is the built-in one); a later layer
// overrides only what it sets.
func Resolve(layers ...Layer) Effective {
	var out Effective
	for _, l := range layers {
		p := l.Policy
		if p == nil {
			continue
		}
		if p.Enabled != nil {
			out.Enabled, out.Sources.Enabled = *p.Enabled, l.Source
		}
		if p.Schedule != nil && p.Schedule.Every != "" {
			// Validated on the way in; a value that no longer parses (a state
			// file edited by hand) is skipped so the layer below still applies.
			if d, err := ParseDuration(p.Schedule.Every); err == nil {
				out.Every, out.Sources.Every = d, l.Source
			}
		}
		if p.Retention != nil && p.Retention.Keep != nil {
			out.Keep, out.Sources.Keep = *p.Retention.Keep, l.Source
		}
	}
	return out
}

// Decode reads a policy, refusing fields this Bay does not enforce.
func Decode(raw []byte) (*Policy, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var p Policy
	if err := dec.Decode(&p); err != nil {
		if field, ok := strings.CutPrefix(err.Error(), "json: unknown field "); ok {
			return nil, fmt.Errorf("backup policy: %s is not supported by this Bay (supported: enabled, schedule.every, retention.keep)", field)
		}
		return nil, fmt.Errorf("backup policy: %w", err)
	}
	if dec.More() {
		return nil, errors.New("backup policy: trailing data after the JSON object")
	}
	return &p, nil
}

// Validate checks a layer's values for the trust its source carries.
//
// The app layer is untrusted input: it arrives with a deploy, written by
// whoever builds the app. So it may not ask to keep everything forever, nor
// more than MaxAppKeep. Intervals are bounded for everyone.
func (p *Policy) Validate(source Source) error {
	if p == nil {
		return nil
	}
	if p.Schedule != nil && p.Schedule.Every != "" {
		d, err := ParseDuration(p.Schedule.Every)
		if err != nil {
			return fmt.Errorf("schedule.every: %w", err)
		}
		if d < MinEvery {
			return fmt.Errorf("schedule.every: %s is shorter than the minimum of %s", p.Schedule.Every, FormatDuration(MinEvery))
		}
		if d > MaxEvery {
			return fmt.Errorf("schedule.every: %s is longer than the maximum of %s", p.Schedule.Every, FormatDuration(MaxEvery))
		}
	}
	if p.Retention != nil && p.Retention.Keep != nil {
		keep := *p.Retention.Keep
		switch {
		case keep < 0:
			return fmt.Errorf("retention.keep: %d is negative", keep)
		case source == App && keep == 0:
			return errors.New("retention.keep: 0 (keep every backup forever) is the operator's choice, not the app's; declare a count")
		case source == App && keep > MaxAppKeep:
			return fmt.Errorf("retention.keep: %d is more than an app may ask for (%d)", keep, MaxAppKeep)
		case keep > MaxKeep:
			return fmt.Errorf("retention.keep: %d is more than %d", keep, MaxKeep)
		}
	}
	return nil
}

// Empty reports whether the layer sets nothing at all.
func (p *Policy) Empty() bool {
	return p == nil || (p.Enabled == nil &&
		(p.Schedule == nil || p.Schedule.Every == "") &&
		(p.Retention == nil || p.Retention.Keep == nil))
}

// Normalize drops empty sub-objects so a stored layer reads back the way it
// was meant ("nothing set") rather than as `{"schedule":{}}`. Nil when empty.
func (p *Policy) Normalize() *Policy {
	if p.Empty() {
		return nil
	}
	out := &Policy{Enabled: p.Enabled}
	if p.Schedule != nil && p.Schedule.Every != "" {
		out.Schedule = &Schedule{Every: p.Schedule.Every}
	}
	if p.Retention != nil && p.Retention.Keep != nil {
		out.Retention = &Retention{Keep: p.Retention.Keep}
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
