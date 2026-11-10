package deploy

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/alepha-dev/bay/internal/runner"
)

// Where an instance's APP_SECRET came from, as deploys, restores and
// `bay status` say it.
const (
	// SecretKept: the instance had its key before, and kept it.
	SecretKept = "kept"
	// SecretMinted: Bay made a new one.
	SecretMinted = "minted"
	// SecretSnapshot: the key came back from the instance's own backup, with
	// its data.
	SecretSnapshot = "snapshot"
	// SecretFromLore: the instance had none, and took the one Lore holds for
	// its copy.
	SecretFromLore = "lore"
)

// ReadAppSecret is the instance's current APP_SECRET, "" when its `.env` holds
// none (or there is no `.env`: nothing was ever provisioned there).
func ReadAppSecret(instance string) (string, error) {
	env, err := runner.LoadEnvFile(filepath.Join(instance, ".env"))
	if err != nil {
		return "", err
	}
	return env["APP_SECRET"], nil
}

/*
InstallAppSecret writes key as the instance's APP_SECRET, leaving every other
line of its `.env` as it is.

Not a way in for an operator: `bay env set` and a deploy's secrets file keep
refusing the name (refuseBayOwned). The callers are Bay's own: a restore
putting back the key its snapshot was sealed with, and the deliberate
`bay secret replace`. The caller stops and restarts the app; the value is
never logged here.
*/
func InstallAppSecret(instance, key string) error {
	if key == "" {
		return errors.New("refusing to install an empty APP_SECRET")
	}
	envPath := filepath.Join(instance, ".env")
	if _, err := os.Stat(envPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("%s has no .env: nothing is deployed there", instance)
		}
		return err
	}
	env, err := runner.LoadEnvFile(envPath)
	if err != nil {
		return err
	}
	env["APP_SECRET"] = key
	return writeEnvFile(envPath, env)
}
