package backuppolicy

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
)

func builtIn() Layer {
	return Layer{Source: BuiltIn, Policy: &Policy{
		Enabled:   Bool(false),
		Schedule:  &Schedule{Every: "1d"},
		Retention: &Retention{Keep: Int(14)},
	}}
}

func TestResolveLaterLayersOverrideOnlyWhatTheySet(t *testing.T) {
	got := Resolve(
		builtIn(),
		Layer{Source: Global, Policy: &Policy{Retention: &Retention{Keep: Int(30)}}},
		Layer{Source: App, Policy: &Policy{Enabled: Bool(true), Schedule: &Schedule{Every: "6h"}}},
		Layer{Source: Operator, Policy: &Policy{Schedule: &Schedule{Every: "12h"}}},
	)
	want := Effective{Enabled: true, Every: 12 * time.Hour, Keep: 30,
		Sources: Sources{Enabled: App, Schedule: Operator, Keep: Global}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestResolveSkipsNilLayersAndUnparseableIntervals(t *testing.T) {
	got := Resolve(builtIn(), Layer{Source: App}, Layer{Source: Operator, Policy: &Policy{Schedule: &Schedule{Every: "soon"}}})
	if got.Every != 24*time.Hour || got.Sources.Schedule != BuiltIn {
		t.Fatalf("a broken interval must fall through to the layer below, got %+v", got)
	}
	if got.Enabled || got.Sources.Enabled != BuiltIn {
		t.Fatalf("got %+v", got)
	}
}

func TestDecodeRefusesFieldsItDoesNotEnforce(t *testing.T) {
	for _, raw := range []string{
		`{"schedule":{"every":"6h","quiesce":true}}`,
		`{"encrypt":true}`,
		`{"retention":{"keep":7,"minutely":7}}`,
	} {
		_, err := Decode([]byte(raw))
		if err == nil || !strings.Contains(err.Error(), "not supported by this Bay") {
			t.Fatalf("%s: want a refusal naming the field, got %v", raw, err)
		}
	}
	if _, err := Decode([]byte(`{"enabled":true} {}`)); err == nil {
		t.Fatal("trailing data must be refused")
	}
	p, err := Decode([]byte(`{"enabled":true,"schedule":{"every":"1d"},"retention":{"keep":7}}`))
	if err != nil || !*p.Enabled || p.Schedule.Every != "1d" || *p.Retention.Keep != 7 {
		t.Fatalf("got %+v %v", p, err)
	}
}

func TestValidateBoundsDependOnTheSource(t *testing.T) {
	cases := []struct {
		name   string
		p      Policy
		source Source
		ok     bool
	}{
		{"too frequent", Policy{Schedule: &Schedule{Every: "1m"}}, Operator, false},
		{"minimum", Policy{Schedule: &Schedule{Every: "5m"}}, App, true},
		{"too rare", Policy{Schedule: &Schedule{Every: "32d"}}, Operator, false},
		{"not a duration", Policy{Schedule: &Schedule{Every: "daily"}}, Global, false},
		{"negative keep", Policy{Retention: &Retention{Keep: Int(-1)}}, Operator, false},
		{"app keep all", Policy{Retention: &Retention{Keep: Int(0)}}, App, false},
		{"operator keep all", Policy{Retention: &Retention{Keep: Int(0)}}, Operator, true},
		{"app keep too many", Policy{Retention: &Retention{Keep: Int(MaxAppKeep + 1)}}, App, false},
		{"operator keep many", Policy{Retention: &Retention{Keep: Int(MaxAppKeep + 1)}}, Operator, true},
		{"operator typo", Policy{Retention: &Retention{Keep: Int(MaxKeep + 1)}}, Operator, false},
		{"two shapes", Policy{Schedule: &Schedule{Every: "6h", Cron: "0 3 * * *"}}, Operator, false},
		{"at", Policy{Schedule: &Schedule{At: []string{"03:00", "15:00"}, Timezone: "Europe/Paris"}}, App, true},
		{"at too close", Policy{Schedule: &Schedule{At: []string{"03:00", "03:02"}}}, Operator, false},
		{"bad timezone", Policy{Schedule: &Schedule{Every: "6h", Timezone: "Mars/Olympus"}}, Operator, false},
		{"cron", Policy{Schedule: &Schedule{Cron: "0 */4 * * *"}}, App, true},
		{"cron every minute", Policy{Schedule: &Schedule{Cron: "* * * * *"}}, Operator, false},
		{"cron yearly", Policy{Schedule: &Schedule{Cron: "0 0 1 1 *"}}, Operator, false},
		{"cron broken", Policy{Schedule: &Schedule{Cron: "0 3 * *"}}, Operator, false},
		{"jitter too long", Policy{Schedule: &Schedule{Jitter: "7h"}}, Operator, false},
		{"window", Policy{Window: "02:00-06:00"}, App, true},
		{"window any", Policy{Window: "any"}, Operator, true},
		{"window broken", Policy{Window: "night"}, Operator, false},
		{"min gap", Policy{MinGap: "15m"}, App, true},
		{"min gap too long", Policy{MinGap: "2d"}, Operator, false},
		{"app daily too many", Policy{Retention: &Retention{Daily: Int(MaxAppKeep + 1)}}, App, false},
		{"negative weekly", Policy{Retention: &Retention{Weekly: Int(-1)}}, Operator, false},
		{"max age", Policy{Retention: &Retention{MaxAge: "180d"}}, App, true},
		{"max age lifted", Policy{Retention: &Retention{MaxAge: "0"}}, Operator, true},
		{"max age too short", Policy{Retention: &Retention{MaxAge: "6h"}}, Operator, false},
		{"app lifecycle", Policy{Prune: "lifecycle"}, App, false},
		{"operator lifecycle", Policy{Prune: "lifecycle"}, Operator, true},
		{"prune typo", Policy{Prune: "s3"}, Operator, false},
		{"verify weekly", Policy{Verify: &Verify{Every: "7d"}}, App, true},
		{"verify off", Policy{Verify: &Verify{Every: "off"}}, App, true},
		{"verify too often", Policy{Verify: &Verify{Every: "10m"}}, Operator, false},
		{"verify too rare", Policy{Verify: &Verify{Every: "120d"}}, Operator, false},
		{"verify typo", Policy{Verify: &Verify{Every: "weekly"}}, Operator, false},
	}
	for _, c := range cases {
		if err := c.p.Validate(c.source); (err == nil) != c.ok {
			t.Errorf("%s: ok=%v, err=%v", c.name, c.ok, err)
		}
	}
}

func TestNormalizeDropsEmptyParts(t *testing.T) {
	if (&Policy{Schedule: &Schedule{}, Retention: &Retention{}}).Normalize() != nil {
		t.Fatal("a layer that sets nothing must normalize to nil")
	}
	p := (&Policy{Enabled: Bool(true), Schedule: &Schedule{}}).Normalize()
	if p == nil || p.Schedule != nil || !*p.Enabled {
		t.Fatalf("got %+v", p)
	}
}

func TestDurationsRoundTrip(t *testing.T) {
	for in, want := range map[string]time.Duration{"7d": 7 * 24 * time.Hour, "6h": 6 * time.Hour, "90m": 90 * time.Minute} {
		d, err := ParseDuration(in)
		if err != nil || d != want {
			t.Fatalf("%s: %v %v", in, d, err)
		}
		if FormatDuration(d) != in {
			t.Fatalf("%s formatted as %s", in, FormatDuration(d))
		}
	}
	for _, bad := range []string{"", "xd", "-1d", "-5m", "tomorrow"} {
		if _, err := ParseDuration(bad); err == nil {
			t.Fatalf("%q should not parse", bad)
		}
	}
}

func TestEffectiveJSONSaysDurationsInWords(t *testing.T) {
	e := Effective{Enabled: true, Every: 6 * time.Hour, Timezone: "UTC", Jitter: 10 * time.Minute,
		Keep: 14, Daily: 7, MaxAge: 180 * 24 * time.Hour, KeepPreDeploy: 5, KeepTagged: true, Prune: PruneBay,
		Sources: Sources{Enabled: App, Schedule: Operator, Keep: BuiltIn}}
	raw, err := json.Marshal(e)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"every":"6h"`, `"jitter":"10m"`, `"maxAge":"180d"`, `"minGap":"0"`, `"schedule":"operator"`} {
		if !strings.Contains(string(raw), want) {
			t.Fatalf("%s lacks %s", raw, want)
		}
	}
	var back Effective
	if err := json.Unmarshal(raw, &back); err != nil || !reflect.DeepEqual(back, e) {
		t.Fatalf("round trip: %+v %v", back, err)
	}
}

func TestResolveScheduleShapesReplaceEachOther(t *testing.T) {
	got := Resolve(
		builtIn(),
		Layer{Source: Global, Policy: &Policy{Schedule: &Schedule{Timezone: "Europe/Paris", Jitter: "10m"}, Window: "01:00-06:00"}},
		Layer{Source: App, Policy: &Policy{Schedule: &Schedule{At: []string{"03:00", "15:00"}}, OnDeploy: Bool(true),
			Retention: &Retention{Daily: Int(7), Weekly: Int(4)}}},
	)
	if got.Every != 12*time.Hour || len(got.At) != 2 || got.Sources.Schedule != App || got.Timezone != "Europe/Paris" ||
		got.Window != "01:00-06:00" || !got.OnDeploy || got.Keep != 14 || got.Daily != 7 || got.Sources.Weekly != App {
		t.Fatalf("got %+v", got)
	}
	if w := got.ScheduleWords(); w != "at 03:00, 15:00 Europe/Paris, window 01:00-06:00, jitter 10m" {
		t.Fatalf("words = %q", w)
	}
	if w := got.RetentionWords(); w != "keep 14, 7 daily, 4 weekly, 0 pre-deploy" {
		t.Fatalf("words = %q", w)
	}
	// The operator goes back to an interval and lifts the window.
	got = Resolve(builtIn(),
		Layer{Source: App, Policy: &Policy{Schedule: &Schedule{Cron: "0 3 * * *"}, Window: "01:00-06:00"}},
		Layer{Source: Operator, Policy: &Policy{Schedule: &Schedule{Every: "6h"}, Window: "any"}},
	)
	if got.Cron != "" || got.Every != 6*time.Hour || got.Window != "" || got.Sources.Window != Operator {
		t.Fatalf("got %+v", got)
	}
	spec := got.Spec()
	if spec.Every != 6*time.Hour || spec.Cron != nil || spec.Window != nil {
		t.Fatalf("spec %+v", spec)
	}
}

func TestJitterStaysUnderHalfTheShortestGap(t *testing.T) {
	e := Effective{Every: time.Hour, Jitter: 6 * time.Hour}
	if j := e.Spec().Jitter; j != 30*time.Minute {
		t.Fatalf("jitter = %v", j)
	}
}

func TestKeepsEverything(t *testing.T) {
	if !(Effective{}).KeepsEverything() || (Effective{Daily: 7}).KeepsEverything() || !(Effective{Keep: 3, Prune: PruneLifecycle}).KeepsEverything() {
		t.Fatal("keeps everything")
	}
}

func TestResolveVerify(t *testing.T) {
	e := Resolve(
		Layer{Source: BuiltIn, Policy: &Policy{Verify: &Verify{Every: "7d"}}},
		Layer{Source: Global, Policy: &Policy{Verify: &Verify{Every: "1d"}}},
	)
	if e.VerifyEvery != 24*time.Hour || e.Sources.Verify != Global || e.VerifyWords() != "restore test every 1d" {
		t.Fatalf("got %v from %s (%s)", e.VerifyEvery, e.Sources.Verify, e.VerifyWords())
	}
	e = Resolve(
		Layer{Source: BuiltIn, Policy: &Policy{Verify: &Verify{Every: "7d"}}},
		Layer{Source: App, Policy: &Policy{Verify: &Verify{Every: VerifyOff}}},
	)
	if e.VerifyEvery != 0 || e.Sources.Verify != App || e.VerifyWords() != "restore test off" {
		t.Fatalf("off: got %v from %s", e.VerifyEvery, e.Sources.Verify)
	}
	raw, err := json.Marshal(e)
	if err != nil || !strings.Contains(string(raw), `"verifyEvery":"off"`) {
		t.Fatalf("JSON %s, %v", raw, err)
	}
	var back Effective
	if err := json.Unmarshal(raw, &back); err != nil || back.VerifyEvery != 0 {
		t.Fatalf("round trip: %+v, %v", back, err)
	}
}

// A deploy may keep more than the operator's global retention, never less:
// the history the operator asked for is not the app's to delete.
func TestTheAppCannotShrinkTheGlobalRetention(t *testing.T) {
	global := Layer{Source: Global, Policy: &Policy{Retention: &Retention{
		Keep: Int(10), Daily: Int(7), Weekly: Int(4), MaxAge: "90d", KeepTagged: Bool(true)}}}

	shrink := Resolve(builtIn(), global, Layer{Source: App, Policy: &Policy{Retention: &Retention{
		Keep: Int(1), Daily: Int(0), Weekly: Int(0), MaxAge: "1d", KeepTagged: Bool(false)}}})
	if shrink.Keep != 10 || shrink.Daily != 7 || shrink.Weekly != 4 || shrink.MaxAge != 90*24*time.Hour || !shrink.KeepTagged {
		t.Fatalf("the app shrank the global retention: %+v", shrink)
	}
	if shrink.Sources.Keep != Global || shrink.Sources.Daily != Global || shrink.Sources.MaxAge != Global {
		t.Fatalf("the global values must still say where they come from: %+v", shrink.Sources)
	}

	grow := Resolve(builtIn(), global, Layer{Source: App, Policy: &Policy{Retention: &Retention{
		Keep: Int(20), Daily: Int(14), Monthly: Int(6), MaxAge: "365d"}}})
	if grow.Keep != 20 || grow.Daily != 14 || grow.Monthly != 6 || grow.MaxAge != 365*24*time.Hour {
		t.Fatalf("the app may keep more: %+v", grow)
	}

	// Over the built-in default, which no operator chose, the app decides.
	own := Resolve(builtIn(), Layer{Source: App, Policy: &Policy{Retention: &Retention{Keep: Int(3)}}})
	if own.Keep != 3 || own.Sources.Keep != App {
		t.Fatalf("the app sets its own count over the built-in: %+v", own)
	}

	// The operator's own per-instance override still wins either way.
	op := Resolve(builtIn(), global, Layer{Source: Operator, Policy: &Policy{Retention: &Retention{Keep: Int(2)}}})
	if op.Keep != 2 {
		t.Fatalf("the operator may lower its own retention: %+v", op)
	}
}

// Staleness is judged against the longest gap the schedule really leaves:
// "every 1h" inside a two-hour window backs up once a day.
func TestLongestGapCountsTheWindowAndMinGap(t *testing.T) {
	for _, c := range []struct {
		name string
		e    Effective
		want time.Duration
	}{
		{"every", Effective{Every: 6 * time.Hour}, 6 * time.Hour},
		{"every in a window", Effective{Every: time.Hour, Window: "02:00-04:00"}, 23 * time.Hour},
		{"window across midnight", Effective{Every: time.Hour, Window: "23:00-01:00"}, 23 * time.Hour},
		{"minGap over every", Effective{Every: time.Hour, MinGap: 12 * time.Hour}, 12 * time.Hour},
		{"slots skipped by minGap", Effective{Every: 12 * time.Hour, At: []string{"03:00", "15:00"}, MinGap: 13 * time.Hour}, 25 * time.Hour},
	} {
		if got := c.e.LongestGap(); got != c.want {
			t.Errorf("%s: LongestGap = %s, want %s", c.name, got, c.want)
		}
	}
}
