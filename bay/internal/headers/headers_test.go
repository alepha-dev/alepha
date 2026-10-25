package headers

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// The conformance fixture the TypeScript reader runs too, checked against
// Cloudflare itself: see testdata/README.md.

type fixtureCase struct {
	Name     string            `json:"name"`
	Path     string            `json:"path"`
	Status   int               `json:"status"`
	Defaults map[string]string `json:"defaults"`
	Expected map[string]string `json:"expected"`
}

type fixtureProblem struct {
	Reason string `json:"reason"`
	Lines  []int  `json:"lines"`
}

type fixtureRefusal struct {
	Name     string           `json:"name"`
	File     string           `json:"file"`
	Problems []fixtureProblem `json:"problems"`
}

func readFixture(t *testing.T, name string) string {
	t.Helper()
	body, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}

func TestFixtureCases(t *testing.T) {
	rules, err := Read(readFixture(t, "_headers"), "testdata/_headers")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []fixtureCase `json:"cases"`
	}
	if err := json.Unmarshal([]byte(readFixture(t, "cases.json")), &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Cases) == 0 {
		t.Fatal("cases.json holds no case")
	}

	for _, c := range fixture.Cases {
		t.Run(c.Name, func(t *testing.T) {
			h := http.Header{}
			for name, value := range c.Defaults {
				h.Set(name, value)
			}
			Apply(rules, c.Path, h)

			got := map[string]string{}
			for name := range h {
				got[strings.ToLower(name)] = strings.Join(h.Values(name), ", ")
			}
			if !reflect.DeepEqual(got, c.Expected) {
				t.Errorf("%s:\n got  %v\n want %v", c.Path, got, c.Expected)
			}
		})
	}
}

func TestFixtureRefusals(t *testing.T) {
	var fixture struct {
		Refusals []fixtureRefusal `json:"refusals"`
	}
	if err := json.Unmarshal([]byte(readFixture(t, "refusals.json")), &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Refusals) == 0 {
		t.Fatal("refusals.json holds no case")
	}

	for _, refusal := range fixture.Refusals {
		t.Run(refusal.Name, func(t *testing.T) {
			rules, problems := Parse(readFixture(t, refusal.File))
			problems = append(problems, Validate(rules)...)

			got := make([]fixtureProblem, 0, len(problems))
			for _, p := range problems {
				got = append(got, fixtureProblem{Reason: p.Reason, Lines: p.Lines})
			}
			if !reflect.DeepEqual(got, refusal.Problems) {
				t.Errorf("%s:\n got  %v\n want %v", refusal.File, got, refusal.Problems)
			}
		})
	}
}

func TestReadNamesTheSourceAndEveryLine(t *testing.T) {
	_, err := Read("/a/:id\n  X-A: 1\n/b\n", "dist/public/_headers")
	if err == nil {
		t.Fatal("a placeholder and an empty rule were accepted")
	}
	message := err.Error()
	for _, want := range []string{"dist/public/_headers:1: ", "dist/public/_headers:3: "} {
		if !strings.Contains(message, want) {
			t.Errorf("%q does not name %q", message, want)
		}
	}
}

func TestParseAcceptsCRLFAndAByteOrderMark(t *testing.T) {
	rules, err := Read("\uFEFF/a\r\nX-A: 1\r\n! X-B\r\n", "_headers")
	if err != nil {
		t.Fatal(err)
	}
	want := []Rule{{
		Path:  "/a",
		Line:  1,
		Unset: []Unset{{Name: "X-B", Line: 3}},
		Set:   []Set{{Name: "X-A", Value: "1", Line: 2}},
	}}
	if !reflect.DeepEqual(rules, want) {
		t.Errorf("got %+v, want %+v", rules, want)
	}
}

func TestSilentJoinNamesAPathBothRulesMatch(t *testing.T) {
	rules, _ := Parse("/docs/*\n  X-A: 1\n/*.md\n  X-A: 2\n")
	problems := Validate(rules)
	if len(problems) != 1 || problems[0].Path != "/docs/.md" {
		t.Errorf("got %+v", problems)
	}
}

func TestApplyAppendsALaterSetOfAHeaderAnEarlierRuleSet(t *testing.T) {
	// A file that does this is refused by Validate, which is exactly why the
	// semantics it would have must still be Cloudflare's.
	rules, _ := Parse("/*\n  X-A: 1\n/a\n  X-A: 2\n")
	h := http.Header{}
	Apply(rules, "/a", h)
	if got := h.Get("X-A"); got != "1, 2" {
		t.Errorf("got %q", got)
	}
}

func TestMatches(t *testing.T) {
	for _, c := range []struct {
		pattern, path string
		want          bool
	}{
		{"/docs/*", "/docs/", true},
		{"/docs/*", "/docs/a/b", true},
		{"/*.js", "/.js", true},
		{"/a*a", "/a", false},
		{"/a*a", "/aa", true},
		{"/caf%C3%A9", "/caf%C3%A9", true},
		{"/caf%C3%A9", "/caf%c3%a9", false},
	} {
		if got := Matches(c.pattern, c.path); got != c.want {
			t.Errorf("Matches(%q, %q) = %v, want %v", c.pattern, c.path, got, c.want)
		}
	}
}
