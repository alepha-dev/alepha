package deploy

// Setting the user's own env vars on a deployed instance.
//
// The instance `.env` already had everything this needs except a way in: it
// survives deploys and rollbacks, `provision` merges into it rather than
// rewriting it, and `bayOwnedKeys` is the list of what Bay refuses to give up.
// What was missing was a caller — the file is 0600 and owned by the app's
// unix user, so an ordinary deploy user over ssh cannot write it and had no
// way to ask Bay to.
//
// Everything here fails loudly. A key Bay owns, a line that is not an
// assignment, a payload with nothing in it, an instance that has no `.env`:
// each is an error naming the key or the line, never a skip. An env var that
// quietly fails to arrive is indistinguishable from one that arrived and did
// nothing, and that is precisely the bug this file exists to close.

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/alepha/bay/internal/runner"
)

// envKeyPattern is what a POSIX-ish environment variable name looks like.
//
// Validated rather than trusted: the key is written into a `.env` that Bay's
// own parser reads back, so a key containing `=` or a newline would round-trip
// as a different variable — or as two.
var envKeyPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// BayOwnedKeys returns the env vars Bay manages, sorted.
//
// A copy, so a caller cannot reorder or extend the list Bay defends. Exported
// because the control API reports it: a client that knows which keys will be
// refused can say so before a deploy rather than after.
func BayOwnedKeys() []string {
	out := append([]string(nil), bayOwnedKeys...)
	sort.Strings(out)
	return out
}

// IsBayOwned reports whether Bay writes this key itself.
func IsBayOwned(key string) bool {
	for _, k := range bayOwnedKeys {
		if k == key {
			return true
		}
	}
	return false
}

// ParseAssignments reads `KEY=VALUE` lines into a map.
//
// Deliberately stricter than [runner.LoadEnvFile], which skips a line it does
// not understand because it is reading a file Bay itself wrote. This reads a
// payload someone sent, where a skipped line is a secret that silently never
// arrived — so a line that is not blank, not a comment and not an assignment
// is an error naming its number.
//
// Blank lines and `#` comments are allowed through, so a `.env` file can be
// piped in whole. Values are literal apart from optional surrounding quotes,
// matching [runner.LoadEnvFile] — a secret containing `$` must survive intact.
func ParseAssignments(r io.Reader) (map[string]string, error) {
	values := map[string]string{}
	sc := bufio.NewScanner(r)
	// A secret can legitimately be long — a PEM key, a service-account JSON —
	// and bufio's 64 KiB default would truncate one mid-line and then fail with
	// "token too long", which names neither the key nor the limit.
	sc.Buffer(make([]byte, 0, 64*1024), maxEnvValueBytes)
	line := 0
	for sc.Scan() {
		line++
		text := strings.TrimSpace(sc.Text())
		if text == "" || strings.HasPrefix(text, "#") {
			continue
		}
		key, value, found := strings.Cut(text, "=")
		if !found {
			return nil, fmt.Errorf("line %d is not an assignment: %q — expected KEY=VALUE", line, text)
		}
		key = strings.TrimSpace(key)
		if !envKeyPattern.MatchString(key) {
			return nil, fmt.Errorf("line %d: %q is not a usable environment variable name (expected %s)",
				line, key, envKeyPattern)
		}
		if _, already := values[key]; already {
			// Last-wins would silently drop one of the two values, and the
			// caller has no way to learn which. Two assignments to one key in
			// one payload is a bug wherever it was composed.
			return nil, fmt.Errorf("line %d: %s is assigned twice in this payload", line, key)
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') ||
				(value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}
		values[key] = value
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	if len(values) == 0 {
		return nil, fmt.Errorf("no assignments were sent — expected KEY=VALUE lines on stdin")
	}
	return values, nil
}

// maxEnvValueBytes bounds one line of the payload.
//
// Generous enough for a PEM key or a service-account JSON blob, small enough
// that a caller streaming nonsense cannot make the supervisor allocate without
// bound.
const maxEnvValueBytes = 1 << 20

// SetEnv merges assignments into an instance's `.env` and reports what moved.
//
// Merge, never truncate: everything already in the file that this payload does
// not mention survives, exactly as it survives a redeploy.
//
// `changed` is the keys whose value is now different. It is separate from
// "keys in the payload" for one reason that matters upstream: an unchanged
// push must not restart the app. `alepha platform up` sends the same secrets
// on every deploy, and a restart per deploy for a file that did not move is an
// outage window bought for nothing.
func SetEnv(instance string, updates map[string]string) (changed []string, err error) {
	envPath := filepath.Join(instance, ".env")
	// The file must already exist. Creating one here would mean happily
	// configuring an app that was never deployed — a write that looks like
	// success and reaches no process, which is the class of bug this whole
	// path exists to remove.
	if _, statErr := os.Stat(envPath); statErr != nil {
		if os.IsNotExist(statErr) {
			return nil, fmt.Errorf("%s has no .env — nothing is deployed there to configure", instance)
		}
		return nil, statErr
	}

	// Refused before anything is written, and ALL of them are named rather
	// than only the first: a caller fixing one at a time learns about the next
	// only by trying again.
	var refused []string
	for key := range updates {
		if IsBayOwned(key) {
			refused = append(refused, key)
		}
	}
	if len(refused) > 0 {
		sort.Strings(refused)
		return nil, fmt.Errorf(
			"refusing to set %s: Bay writes %s itself on every deploy. "+
				"APP_SECRET in particular is the instance's session key — overwriting it signs every "+
				"user out and cannot be undone, because the value it replaced is gone",
			strings.Join(refused, ", "), pluralKeys(len(refused)))
	}

	env, err := runner.LoadEnvFile(envPath)
	if err != nil {
		return nil, err
	}
	for key, value := range updates {
		if existing, ok := env[key]; ok && existing == value {
			continue
		}
		env[key] = value
		changed = append(changed, key)
	}
	sort.Strings(changed)
	if len(changed) == 0 {
		return nil, nil
	}
	if err := writeEnvFile(envPath, env); err != nil {
		return nil, err
	}
	return changed, nil
}

func pluralKeys(n int) string {
	if n == 1 {
		return "that key"
	}
	return "those keys"
}

// EnvKeys reports which variables an instance's `.env` holds, by NAME.
//
// Never the values. This answers "is STRIPE_KEY configured on the host?", which
// is the question a deploy tool has to be able to ask, and it is a strictly
// smaller answer than "what is it?" — the same reason `bay config s3` never
// echoes a secret key back.
//
// Split, because the two halves mean different things: `app` is what someone
// set through this path and can change, `bayOwned` is what Bay writes and will
// refuse to take.
func EnvKeys(instance string) (app []string, bayOwned []string, err error) {
	envPath := filepath.Join(instance, ".env")
	if _, statErr := os.Stat(envPath); statErr != nil {
		if os.IsNotExist(statErr) {
			return nil, nil, fmt.Errorf("%s has no .env — nothing is deployed there", instance)
		}
		return nil, nil, statErr
	}
	env, err := runner.LoadEnvFile(envPath)
	if err != nil {
		return nil, nil, err
	}
	app, bayOwned = []string{}, []string{}
	for key := range env {
		if IsBayOwned(key) {
			bayOwned = append(bayOwned, key)
			continue
		}
		app = append(app, key)
	}
	sort.Strings(app)
	sort.Strings(bayOwned)
	return app, bayOwned, nil
}
