package deploy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A key taken from Lore is as fresh as a minted one: the snapshot restored in
// the same deploy replaces it, since the snapshot is what the data was
// sealed with.
func TestOnlyAKeptKeyIsNotFresh(t *testing.T) {
	for source, fresh := range map[string]bool{SecretKept: false, SecretMinted: true, SecretFromLore: true, "": false} {
		if got := (&Result{SecretSource: source}).SecretFresh(); got != fresh {
			t.Errorf("SecretFresh(%q) = %v, want %v", source, got, fresh)
		}
	}
}

func TestInstallAppSecretKeepsEveryOtherLine(t *testing.T) {
	dir := t.TempDir()
	if err := InstallAppSecret(dir, "k"); err == nil || !strings.Contains(err.Error(), "no .env") {
		t.Fatalf("an instance never provisioned has no .env to write: %v", err)
	}
	if err := writeEnvFile(filepath.Join(dir, ".env"), map[string]string{"APP_SECRET": "old", "STRIPE_KEY": "sk"}); err != nil {
		t.Fatal(err)
	}
	if err := InstallAppSecret(dir, ""); err == nil {
		t.Fatal("an empty key must be refused")
	}
	if err := InstallAppSecret(dir, "new-key"); err != nil {
		t.Fatal(err)
	}
	if got, _ := ReadAppSecret(dir); got != "new-key" {
		t.Fatalf("key = %q", got)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, ".env"))
	if !strings.Contains(string(raw), `STRIPE_KEY="sk"`) {
		t.Fatalf("the app's own variables must survive: %s", raw)
	}
}
