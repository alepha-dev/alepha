package naming

import "testing"

// The pair folds into ONE segment, which is what lets a caller widen it.
//
// ⚠️ The second case is the whole reason this package exists: `alepha platform`
// passes a bare app name, Lore passes `<project>-<app>`, and Bay composes the
// same way for both. Two Lore projects that each call an app `api` used to meet
// at one directory, one S3 prefix and one set of backup keys.
func TestInstanceFoldsThePairIntoOneSegment(t *testing.T) {
	for _, c := range []struct {
		name, env, want string
	}{
		{"club", "production", "club-production"},
		{"alepha-club", "production", "alepha-club-production"},
		{"lore", "bay", "lore-bay"},
		{"lindocara-main", "production", "lindocara-main-production"},
	} {
		if got := Instance(c.name, c.env); got != c.want {
			t.Errorf("Instance(%q, %q) = %q, want %q", c.name, c.env, got, c.want)
		}
	}
}

// ⚠️ Not reversible, and this test exists so nobody writes a parser for it.
//
// `a-b` + `c` and `a` + `b-c` compose to the same segment, so the segment is an
// address and never a record. Every caller that needs the pair back has
// `state.App`, which carries both fields.
func TestInstanceIsNotReversible(t *testing.T) {
	if Instance("a-b", "c") != Instance("a", "b-c") {
		t.Fatal("the ambiguity this test documents no longer exists; if the " +
			"segment became parseable, say so where callers can see it")
	}
}
