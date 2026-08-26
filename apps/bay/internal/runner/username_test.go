package runner

import (
	"strings"
	"testing"
)

// The per-instance unix user is what keeps one app out of another's `.env`
// and database. `UserName` used to cut the unit name at 32 characters, which
// makes it a many-to-one function of the key: two instances whose names
// differ only past the cut got the SAME user, and that user owned both sets
// of secrets. The isolation the user exists to provide was removed by the
// squeeze meant to make it fit.
func TestUserNameKeepsTwoLongInstancesApart(t *testing.T) {
	a := "analytics-ingestion-service/production"
	b := "analytics-ingestion-service/preproduction"

	// Both keys share the first 32 characters of their unit name, which is
	// the whole point: truncation cannot tell them apart.
	if unitName(a)[:32] != unitName(b)[:32] {
		t.Fatalf("the fixture no longer exercises the collision: %q vs %q",
			unitName(a)[:32], unitName(b)[:32])
	}

	if UserName(a) == UserName(b) {
		t.Fatalf("two instances share the unix user %q, so each can read the other's secrets", UserName(a))
	}
	for _, key := range []string{a, b} {
		name := UserName(key)
		if len(name) > maxUserNameLen {
			t.Fatalf("useradd refuses %q: %d characters", name, len(name))
		}
		if !strings.HasPrefix(name, "bay-") {
			t.Fatalf("a name an operator reads in `ps` must still say whose it is: %q", name)
		}
		if strings.HasSuffix(name, "-") || strings.Contains(name, "--") {
			t.Fatalf("malformed user name %q", name)
		}
	}
}

// The same key must always answer the same name - the user owns files across
// deploys, so an answer that drifts orphans them.
func TestUserNameIsStable(t *testing.T) {
	key := "analytics-ingestion-service/production"
	if UserName(key) != UserName(key) {
		t.Fatal("UserName is not deterministic")
	}
}

// Every instance provisioned before the hash owns its files as
// `bay-<app>-<env>`. Changing what `UserName` answers for a name that always
// fitted would orphan that ownership on the next deploy: the app would start
// as a user with no access to its own database.
func TestUserNameLeavesShortNamesUntouched(t *testing.T) {
	for _, key := range []string{"lore/production", "shop/staging", "a/b"} {
		if got, want := UserName(key), unitName(key); got != want {
			t.Fatalf("UserName(%q) = %q, want the unchanged %q", key, got, want)
		}
	}
}

// The boundary itself: exactly 32 is fine, 33 is not.
func TestUserNameHashesOnlyPastTheLimit(t *testing.T) {
	// "bay-" + 28 characters = 32.
	fits := strings.Repeat("a", 26) + "/b"
	if len(unitName(fits)) != maxUserNameLen {
		t.Fatalf("fixture is %d characters, want %d", len(unitName(fits)), maxUserNameLen)
	}
	if UserName(fits) != unitName(fits) {
		t.Fatalf("a name that fits exactly must be left alone: %q", UserName(fits))
	}

	over := strings.Repeat("a", 27) + "/b"
	if UserName(over) == unitName(over) {
		t.Fatal("a name one character over the limit must be squeezed")
	}
	if len(UserName(over)) > maxUserNameLen {
		t.Fatalf("the squeeze produced %d characters", len(UserName(over)))
	}
}

// Two SHORT keys can still collide, and that is on purpose.
//
// The "/" becomes a "-", which is lossy: `demo-staging/eu` and
// `demo/staging-eu` are different instances with the same unit name, both
// well inside the limit, so both are returned unchanged. Making them
// distinct would mean changing the name of every instance that already owns
// files under it - orphaning that ownership on the next deploy, for the sake
// of a pair that `Deploy` refuses outright.
//
// So this pins the shape of the remaining hole, and
// `TestDeployRefusesAUnixUserAnotherInstanceHolds` is what closes it.
func TestUserNameCanCollideOnShortKeysAndIsRefusedElsewhere(t *testing.T) {
	a := "demo-staging/eu"
	b := "demo/staging-eu"
	if UserName(a) != UserName(b) {
		t.Fatalf(
			"`UserName` became injective for short keys (%q vs %q) - good, but the deploy-time "+
				"refusal's own test uses this pair to reach the refusal branch, so give it another",
			UserName(a), UserName(b))
	}
}

// A long key, in contrast, IS separated: the hash is taken over the whole
// key, so the "/" position survives it.
func TestUserNameSeparatesLongKeysWhateverTheSeparatorDid(t *testing.T) {
	long := strings.Repeat("x", 30)
	a := long + "-b/c"
	b := long + "/b-c"
	if unitName(a) != unitName(b) {
		t.Fatalf("the fixture no longer produces equal unit names: %q vs %q",
			unitName(a), unitName(b))
	}
	if UserName(a) == UserName(b) {
		t.Fatalf("two distinct keys share the unix user %q", UserName(a))
	}
}
