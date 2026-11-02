package backuppolicy

import (
	"encoding/json"
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
		Sources: Sources{Enabled: App, Every: Operator, Keep: Global}}
	if got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestResolveSkipsNilLayersAndUnparseableIntervals(t *testing.T) {
	got := Resolve(builtIn(), Layer{Source: App}, Layer{Source: Operator, Policy: &Policy{Schedule: &Schedule{Every: "soon"}}})
	if got.Every != 24*time.Hour || got.Sources.Every != BuiltIn {
		t.Fatalf("a broken interval must fall through to the layer below, got %+v", got)
	}
	if got.Enabled || got.Sources.Enabled != BuiltIn {
		t.Fatalf("got %+v", got)
	}
}

func TestDecodeRefusesFieldsItDoesNotEnforce(t *testing.T) {
	for _, raw := range []string{
		`{"schedule":{"every":"6h","at":"03:00"}}`,
		`{"encrypt":true}`,
		`{"retention":{"keep":7,"daily":7}}`,
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
	e := Effective{Enabled: true, Every: 6 * time.Hour, Keep: 14, Sources: Sources{App, Operator, BuiltIn}}
	raw, err := json.Marshal(e)
	if err != nil {
		t.Fatal(err)
	}
	if want := `{"enabled":true,"every":"6h","keep":14,"source":{"enabled":"app","every":"operator","keep":"built-in"}}`; string(raw) != want {
		t.Fatalf("got %s", raw)
	}
	var back Effective
	if err := json.Unmarshal(raw, &back); err != nil || back != e {
		t.Fatalf("round trip: %+v %v", back, err)
	}
}
