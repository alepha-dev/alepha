package stack

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/alepha-dev/bay/internal/runner"
)

// LoadVars reads a stack environment's variables; none yet is an empty map.
func LoadVars(root, stack, env string) (map[string]string, error) {
	return runner.LoadEnvFile(VarsFile(root, stack, env))
}

/*
SetVars merges updates into a stack environment's variables and answers the
keys whose value changed, so an unchanged push redeploys nothing.

Written atomically at 0600: the file holds a stack's passwords. Nothing is
refused by name here, unlike an app's own `.env`: `APP_SECRET` is an ordinary
variable for Umami. For an app service Bay's own keys still win (AppEnv).
*/
func SetVars(root, stack, env string, updates map[string]string) ([]string, error) {
	for key := range updates {
		if !validVarName(key) {
			return nil, fmt.Errorf("%q is not a variable name: letters, digits and underscores, not starting with a digit", key)
		}
	}
	current, err := LoadVars(root, stack, env)
	if err != nil {
		return nil, err
	}
	var changed []string
	for k, v := range updates {
		if old, ok := current[k]; ok && old == v {
			continue
		}
		current[k] = v
		changed = append(changed, k)
	}
	sort.Strings(changed)
	if len(changed) == 0 {
		return nil, nil
	}
	return changed, writeVars(VarsFile(root, stack, env), current)
}

// UnsetVars removes variables and answers the ones that existed.
func UnsetVars(root, stack, env string, keys []string) ([]string, error) {
	current, err := LoadVars(root, stack, env)
	if err != nil {
		return nil, err
	}
	var removed []string
	for _, k := range keys {
		if _, ok := current[k]; ok {
			delete(current, k)
			removed = append(removed, k)
		}
	}
	sort.Strings(removed)
	if len(removed) == 0 {
		return nil, nil
	}
	return removed, writeVars(VarsFile(root, stack, env), current)
}

// VarNames lists a stack environment's variables by name, never by value.
func VarNames(root, stack, env string) ([]string, error) {
	current, err := LoadVars(root, stack, env)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(current))
	for k := range current {
		names = append(names, k)
	}
	sort.Strings(names)
	return names, nil
}

/*
AppEnv is what an app service runs with: the stack's variables, overlaid by
the app's own `.env`, which already carries Bay's keys. So, highest first:
Bay's keys, the app's variables, the stack's.
*/
func AppEnv(stackVars, appEnv map[string]string) map[string]string {
	out := make(map[string]string, len(stackVars)+len(appEnv))
	for k, v := range stackVars {
		out[k] = v
	}
	for k, v := range appEnv {
		out[k] = v
	}
	return out
}

func validVarName(name string) bool {
	if name == "" || (name[0] >= '0' && name[0] <= '9') {
		return false
	}
	for _, r := range name {
		if !(r == '_' || r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9') {
			return false
		}
	}
	return true
}

func writeVars(path string, vars map[string]string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	keys := make([]string, 0, len(vars))
	for k := range vars {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	b.WriteString("# A stack environment's variables, managed by Bay.\n")
	for _, k := range keys {
		fmt.Fprintf(&b, "%s=%s\n", k, runner.QuoteEnvValue(vars[k]))
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".env-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.WriteString(b.String()); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
