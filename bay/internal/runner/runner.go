// Package runner starts and stops app processes.
//
// One implementation: Docker containers (docker.go), the supervisor since
// epic E73 replaced systemd units and plain child processes. The interface is
// what the rest of Bay talks to, and what the tests substitute.
package runner

import (
	"bufio"
	"os"
	"strings"
	"time"
)

// Spec is everything needed to launch one app instance.
type Spec struct {
	Key string // "lore/production"
	// Runtime and Entry are the command inside the image for an archive app
	// ("node", "index.node.js"). Both empty for an image app, which runs its
	// image's own command.
	Runtime string
	Entry   string
	Env     map[string]string // resolved environment
	// Sandbox carries backend-specific settings: a Container for the Docker
	// runner.
	Sandbox any
}

// Runner supervises app processes.
type Runner interface {
	Start(spec Spec) error
	Stop(key string, grace time.Duration) error
	// Park takes the app out of service and keeps it out across a reboot: for
	// systemd, `systemctl disable --now`.
	//
	// Separate from Stop, and it has to be. Deploy calls Stop then Start
	// internally on every redeploy; if that Stop disabled the unit and Bay
	// crashed between the two, the app would be gone after the next reboot
	// with nothing saying why. Park is only ever reached by an operator or a
	// console saying "take this out of service", and Start re-enables, so a
	// deploy or a start undoes it by construction.
	Park(key string, grace time.Duration) error
	// Remove uninstalls whatever the supervisor installed for the app, after
	// Stop: for systemd that is the unit file and its enable symlink, without
	// which an unregistered app comes back at the next reboot.
	//
	// `purge` says the app's data is being destroyed too, and gates only the
	// parts that must not outlive it — for systemd, the unix user. See
	// deleteUser.
	Remove(key string, purge bool) error
	Running(key string) bool
	// State is what the supervisor calls the unit right now, in its own
	// words: systemd's ActiveState, so `inactive`, `failed`, `activating`,
	// `active`. Empty when the supervisor cannot say.
	//
	// `Running` collapses three of those into one false, and the console has
	// to tell them apart: an app somebody stopped, an app past its restart
	// limit, and an auto-restart in flight are three different sentences to
	// put in front of an operator.
	State(key string) string
	StopAll(grace time.Duration)
	// Usage reports what the supervisor knows about the app right now, or
	// false when it knows nothing — an unsupervised child process, an app that
	// is not running, a host without cgroups.
	Usage(key string) (Usage, bool)
	// Logs returns the last n entries this supervisor has for the app, and
	// whether it supervises it at all.
	//
	// The bool carries the distinction that matters when nothing comes back:
	// "this Bay has never started that app" and "it started and said nothing"
	// send an operator to two different places, and an empty slice alone cannot
	// tell them apart.
	Logs(key string, n int) ([]LogLine, bool, error)
}

// defaultStopGrace applies when a caller did not say. See stopGraceOf.
const defaultStopGrace = 30 * time.Second

// stopCallMargin is how much longer than the app's own grace Bay waits for the
// supervisor's stop call to return. Enough for it to send SIGKILL and reap;
// short enough that a broken supervisor does not wedge a deploy.
const stopCallMargin = 10 * time.Second

// LoadEnvFile parses a .env file into a map.
//
// No shell expansion, because a secret containing `$` must survive intact.
// Quoting and escapes follow [UnquoteEnvValue], which is the same grammar
// systemd's EnvironmentFile uses and the same one [QuoteEnvValue] writes.
func LoadEnvFile(path string) (map[string]string, error) {
	env := map[string]string{}
	f, err := os.Open(path)
	if os.IsNotExist(err) {
		return env, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	// The same ceiling as deploy.ParseAssignments (1 MiB): `bay env set`
	// accepts a PEM key or a service-account JSON, and the default 64 KiB
	// token made every later read of the file fail with "token too long",
	// which left the instance unable to start.
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		env[key] = UnquoteEnvValue(value)
	}
	return env, sc.Err()
}
