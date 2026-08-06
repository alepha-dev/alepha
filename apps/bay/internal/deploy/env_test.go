package deploy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// instanceWithEnv is a deployed app's directory, with the `.env` `provision`
// would have written.
func instanceWithEnv(t *testing.T, lines string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte(lines), 0o600); err != nil {
		t.Fatal(err)
	}
	return dir
}

func readEnv(t *testing.T, instance string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(instance, ".env"))
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestSetEnvMergesAndKeepsWhatItDidNotMention(t *testing.T) {
	// The whole reason the instance `.env` outlives releases is that a user's
	// key survives a redeploy. A set that truncated the file would undo that in
	// one command.
	instance := instanceWithEnv(t, "APP_SECRET=keepme\nSTRIPE_KEY=old\nMAILER_DSN=smtp://x\n")

	changed, err := SetEnv(instance, map[string]string{"STRIPE_KEY": "new"})
	if err != nil {
		t.Fatal(err)
	}
	if len(changed) != 1 || changed[0] != "STRIPE_KEY" {
		t.Fatalf("expected STRIPE_KEY changed, got %v", changed)
	}
	env := readEnv(t, instance)
	for _, want := range []string{"APP_SECRET=keepme", "STRIPE_KEY=new", "MAILER_DSN=smtp://x"} {
		if !strings.Contains(env, want) {
			t.Fatalf("expected %q in the merged .env, got:\n%s", want, env)
		}
	}
}

func TestSetEnvRefusesABayOwnedKeyByName(t *testing.T) {
	// The expensive one. Bay generates APP_SECRET per instance and never
	// regenerates it, because a new value signs every user out and the old one
	// is gone. A caller that can overwrite it has that outage one typo away.
	instance := instanceWithEnv(t, "APP_SECRET=original\n")

	_, err := SetEnv(instance, map[string]string{"APP_SECRET": "attacker"})
	if err == nil {
		t.Fatal("setting APP_SECRET must be refused")
	}
	if !strings.Contains(err.Error(), "APP_SECRET") {
		t.Fatalf("the refusal must name the key, got: %v", err)
	}
	if !strings.Contains(readEnv(t, instance), "APP_SECRET=original") {
		t.Fatalf("a refused set must write nothing, .env is now:\n%s", readEnv(t, instance))
	}
}

func TestSetEnvRefusesTheWholeBatchWhenOneKeyIsBayOwned(t *testing.T) {
	// All-or-nothing: a partial write would leave the caller believing the
	// batch landed, with one key missing and no way to tell which.
	instance := instanceWithEnv(t, "APP_SECRET=original\n")

	_, err := SetEnv(instance, map[string]string{"STRIPE_KEY": "sk_live", "DATABASE_URL": "postgres://x"})
	if err == nil {
		t.Fatal("a batch containing a Bay-owned key must be refused")
	}
	if strings.Contains(readEnv(t, instance), "STRIPE_KEY") {
		t.Fatalf("nothing from a refused batch may be written, .env is now:\n%s", readEnv(t, instance))
	}
}

func TestSetEnvReportsNoChangeWhenTheValueIsAlreadyThat(t *testing.T) {
	// `alepha platform up` pushes the same secrets on every deploy. If an
	// identical push counted as a change, every deploy would take a second
	// restart for a file that did not move.
	instance := instanceWithEnv(t, "STRIPE_KEY=same\n")

	changed, err := SetEnv(instance, map[string]string{"STRIPE_KEY": "same"})
	if err != nil {
		t.Fatal(err)
	}
	if len(changed) != 0 {
		t.Fatalf("an identical value is not a change, got %v", changed)
	}
}

func TestSetEnvRefusesAnInstanceThatHasNoEnv(t *testing.T) {
	// Creating one here would mean configuring an app that was never deployed:
	// a write that succeeds and reaches no process.
	_, err := SetEnv(t.TempDir(), map[string]string{"STRIPE_KEY": "sk"})
	if err == nil {
		t.Fatal("an instance with no .env must be refused")
	}
	if !strings.Contains(err.Error(), "nothing is deployed") {
		t.Fatalf("the refusal must say why, got: %v", err)
	}
}

func TestParseAssignmentsRefusesALineThatIsNotAnAssignment(t *testing.T) {
	// runner.LoadEnvFile skips such a line, which is right for a file Bay
	// wrote. Here it is a secret that silently never arrived.
	_, err := ParseAssignments(strings.NewReader("STRIPE_KEY=sk_live\nthis is not an assignment\n"))
	if err == nil {
		t.Fatal("a non-assignment line must be an error, not a skip")
	}
	if !strings.Contains(err.Error(), "line 2") {
		t.Fatalf("the error must name the line, got: %v", err)
	}
}

func TestParseAssignmentsRefusesAnEmptyPayload(t *testing.T) {
	// "Pushed nothing" and "pushed successfully" must not look the same.
	if _, err := ParseAssignments(strings.NewReader("# only a comment\n\n")); err == nil {
		t.Fatal("a payload with no assignments must be an error")
	}
}

func TestParseAssignmentsRefusesADuplicateKey(t *testing.T) {
	_, err := ParseAssignments(strings.NewReader("A=1\nA=2\n"))
	if err == nil {
		t.Fatal("one key assigned twice in one payload must be an error")
	}
	if !strings.Contains(err.Error(), "twice") {
		t.Fatalf("the error must say what is wrong, got: %v", err)
	}
}

func TestParseAssignmentsRefusesAnUnusableKeyName(t *testing.T) {
	if _, err := ParseAssignments(strings.NewReader("not a key=1\n")); err == nil {
		t.Fatal("a key with a space must be refused")
	}
}

func TestParseAssignmentsKeepsAValueLiteral(t *testing.T) {
	// A secret containing `$`, `=` or `#` must survive intact — the same rule
	// runner.LoadEnvFile follows, and the reason neither does shell expansion.
	values, err := ParseAssignments(strings.NewReader(
		"A=pa$$word=with=equals\nB=\"quoted\"\nC=# not a comment\n"))
	if err != nil {
		t.Fatal(err)
	}
	if values["A"] != "pa$$word=with=equals" {
		t.Fatalf("value A was mangled: %q", values["A"])
	}
	if values["B"] != "quoted" {
		t.Fatalf("surrounding quotes should be stripped: %q", values["B"])
	}
	if values["C"] != "# not a comment" {
		t.Fatalf("a # after the = is part of the value: %q", values["C"])
	}
}

func TestEnvKeysReportsNamesSplitByOwnership(t *testing.T) {
	instance := instanceWithEnv(t, "APP_SECRET=s3cret\nDATABASE_URL=sqlite://x\nSTRIPE_KEY=sk_live\n")

	app, bay, err := EnvKeys(instance)
	if err != nil {
		t.Fatal(err)
	}
	if len(app) != 1 || app[0] != "STRIPE_KEY" {
		t.Fatalf("app-owned keys should be exactly STRIPE_KEY, got %v", app)
	}
	if len(bay) != 2 {
		t.Fatalf("APP_SECRET and DATABASE_URL are Bay's, got %v", bay)
	}
}

func TestBayOwnedKeysCoversTheSecretThatCannotBeRegenerated(t *testing.T) {
	// A guard on the list itself: dropping APP_SECRET from it would make the
	// refusal above disappear without a single test naming APP_SECRET failing.
	for _, key := range []string{"APP_SECRET", "DATABASE_URL", "NODE_ENV", "STORAGE_PATH", "DATA_DIR"} {
		if !IsBayOwned(key) {
			t.Fatalf("%s must stay Bay-owned", key)
		}
	}
	if IsBayOwned("STRIPE_KEY") {
		t.Fatal("an ordinary app key must not be Bay-owned")
	}
}
