package main

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
The socket handoff: a Bay hands its listening sockets to its successor, so a
restart of the proxy (a reload, an upgrade) refuses no connection (#Q3743).
It is Pingora's graceful upgrade, done with Cloudflare's tableflip.

The sequence, from the old process's side:

 1. handOver refuses while anything is running that the new process would
    not know about, then FREEZES: from here this process only proxies.
 2. tableflip starts the new process from os.Args[0] with the listening
    sockets, and waits for it to say it is ready, 60 s at most.
 3. Ready: this process stops accepting, drains, closes the control socket
    and the Lore connection, and exits 0. The new one opens both once this
    one is gone.
    Not ready (it exited, or the minute ran out): it is killed, this process
    unfreezes and carries on. That is the whole rollback, and it costs
    nothing: a binary that cannot serve never served.

Why the freeze starts at step 1 and not at Ready: the new process reads
state.json when it boots. Anything this one wrote after that would be lost the
next time the new one writes, and a deploy accepted in between would be cut by
the drain. So two Bays never write state, and never run a backup, at the same
time.
*/

// handoffTimeout is how long a successor gets to say it is ready before it is
// killed and the old process carries on.
const handoffTimeout = 60 * time.Second

// handingOver is what every refused write says while a handoff runs.
const handingOver = "Bay is handing over to a new version, try again in a minute"

/*
ledger is the work in flight that a handoff must not cut, and the freeze
itself.

The machine mutex of the connector does not cover a backup, a restore, a log
read or anything started from the control socket, and none of those would
survive the old process leaving. So each registers here for as long as it
runs, and one lock decides both questions at once: nothing is running, and
nothing more may start.
*/
type ledger struct {
	mu     sync.Mutex
	frozen bool
	next   int
	work   map[int]string
}

/*
beginWork registers something a handoff must wait for, or refuses it while one
runs. The returned function says the work is over; calling it twice is safe.
*/
func (s *server) beginWork(what string) (func(), error) {
	l := &s.ledger
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.frozen {
		return nil, errors.New(handingOver)
	}
	if l.work == nil {
		l.work = map[int]string{}
	}
	l.next++
	id := l.next
	l.work[id] = what
	return func() {
		l.mu.Lock()
		delete(l.work, id)
		l.mu.Unlock()
	}, nil
}

/*
freeze stops this Bay taking on work, or says what is running and leaves it
unfrozen.

It reads `busy` too (the instances a deploy or a restore holds), under the
ledger's lock: whatever claims an instance registered its work first, so
nothing can slip in between the two checks.
*/
func (s *server) freeze() error {
	l := &s.ledger
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.frozen {
		return errors.New("a handoff is already running")
	}
	running := map[string]bool{}
	for _, what := range l.work {
		running[what] = true
	}
	s.busyMu.Lock()
	for key, what := range s.busy {
		running["a "+what+" of "+key] = true
	}
	s.busyMu.Unlock()
	if s.booting.Load() {
		running["the start of this Bay's apps"] = true
	}
	if len(running) > 0 {
		names := make([]string, 0, len(running))
		for what := range running {
			names = append(names, what)
		}
		sort.Strings(names)
		return fmt.Errorf("Bay cannot hand over while this is running: %s", strings.Join(names, ", "))
	}
	l.frozen = true
	return nil
}

/*
handoffBlocked says what would refuse a handoff right now, without starting
one: what the `upgrade` verb asks before it downloads anything. freeze asks
again, under the lock, when the handoff starts.
*/
func (s *server) handoffBlocked() error {
	if err := s.freeze(); err != nil {
		return err
	}
	s.unfreeze()
	return nil
}

func (s *server) unfreeze() {
	s.ledger.mu.Lock()
	s.ledger.frozen = false
	s.ledger.mu.Unlock()
}

func (s *server) isFrozen() bool {
	s.ledger.mu.Lock()
	defer s.ledger.mu.Unlock()
	return s.ledger.frozen
}

/*
handOver starts a successor and waits for it: nil once it serves, the reason
it does not otherwise, in which case this process has carried on as if nothing
was asked.

`systemctl reload bay` (SIGHUP) and the `upgrade` verb both end here. On
success the caller has nothing left to do but return: `serve` sees the handoff
and leaves.
*/
func (s *server) handOver() error {
	if s.upgrade == nil {
		return errors.New("this Bay cannot hand over: it is not serving")
	}
	if err := s.freeze(); err != nil {
		return err
	}
	// The last write this process makes. Traffic served from here on is not
	// recorded: a few seconds of a timestamp nobody reads to the second.
	s.flushLastSeen()
	s.log.Info("handing over to a new process", "timeout", handoffTimeout)
	if err := s.upgrade(); err != nil {
		s.unfreeze()
		s.log.Error("the new process did not take over: this one keeps serving", "err", err)
		return err
	}
	s.log.Info("the new process is ready")
	return nil
}

/*
guardControl is the freeze on the control socket: a write is refused while a
handoff runs, and registered as work while it is served, so a handoff is
refused while a write runs.

Reads pass: `bay list` and `bay status` change nothing and must keep
answering during a handoff, which is when somebody is most likely to look.
*/
func (s *server) guardControl(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet || r.Method == http.MethodHead {
			next.ServeHTTP(w, r)
			return
		}
		done, err := s.beginWork("a control request (" + r.Method + " " + r.URL.Path + ")")
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, err.Error())
			return
		}
		defer done()
		next.ServeHTTP(w, r)
	})
}

// handoffErrorFile is where a successor that cannot serve leaves its reason
// for the process that started it. See leaveHandoffError.
func handoffErrorFile(root string) string {
	return filepath.Join(root, "handoff.err")
}

/*
leaveHandoffError writes why a successor is giving up, for its parent to log
and to report.

tableflip tells the parent only that its child exited and with what status.
The child's stderr is the parent's own (the journal, under systemd), so the
message is there too, but not in a form the parent can quote back to whoever
asked for the upgrade.
*/
func leaveHandoffError(root string, err error) {
	_ = os.WriteFile(handoffErrorFile(root), []byte(err.Error()+"\n"), 0o600)
}

// withHandoffError completes tableflip's error with what the child left.
func withHandoffError(root string, err error) error {
	raw, readErr := os.ReadFile(handoffErrorFile(root))
	_ = os.Remove(handoffErrorFile(root))
	if why := strings.TrimSpace(string(raw)); readErr == nil && why != "" {
		return fmt.Errorf("%w: %s", err, why)
	}
	return err
}

// The ways this Bay can be upgraded, as it reports them to Lore.
const (
	// upgradeHandoff: under systemd, with the handoff drop-in in effect. The
	// only mode in which a handoff is safe to start from outside.
	upgradeHandoff = "handoff"
	// upgradeRestart: under systemd without the drop-in. systemd would see
	// its main process exit, kill the successor with the cgroup and start
	// Bay again: the outage a handoff exists to remove.
	upgradeRestart = "restart"
	// upgradeManual: not under systemd, so nothing here knows how this Bay
	// is kept running.
	upgradeManual = "manual"
)

// handoffDropIn is what the unit needs for systemd to follow a handoff, and
// where install.sh writes it.
const handoffDropIn = "bay.service.d/handoff.conf"

/*
pidFilePath is where Bay writes its PID for systemd to follow: bay.pid in the
unit's runtime directory (`RuntimeDirectory=bay`, so /run/bay). Empty outside
systemd, where nothing reads one.
*/
func pidFilePath() string {
	dir, _, _ := strings.Cut(os.Getenv("RUNTIME_DIRECTORY"), ":")
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, "bay.pid")
}

/*
ownUnit is the systemd service this process runs in, from its cgroup, or
empty: a shell session's cgroup ends in a scope, a container's in nothing
systemd named.
*/
func ownUnit() string {
	if runtime.GOOS != "linux" {
		return ""
	}
	raw, err := os.ReadFile("/proc/self/cgroup")
	if err != nil {
		return ""
	}
	return unitOfCgroup(string(raw))
}

func unitOfCgroup(cgroup string) string {
	for _, line := range strings.Split(strings.TrimSpace(cgroup), "\n") {
		// "0::/system.slice/bay.service" on cgroup v2, the only one Bay runs on.
		_, path, ok := strings.Cut(line, "::")
		if !ok {
			continue
		}
		if unit := filepath.Base(path); strings.HasSuffix(unit, ".service") {
			return unit
		}
	}
	return ""
}

/*
dropInInEffect reads `systemctl show -p PIDFile -p ExecReload` and says
whether the unit has what a handoff needs: the PID file Bay writes, and a
reload that sends SIGHUP.
*/
func dropInInEffect(show, pidFile string) bool {
	hasPID, hasReload := false, false
	for _, line := range strings.Split(show, "\n") {
		key, value, _ := strings.Cut(strings.TrimSpace(line), "=")
		switch key {
		case "PIDFile":
			hasPID = pidFile != "" && value == pidFile
		case "ExecReload":
			hasReload = strings.Contains(value, "HUP")
		}
	}
	return hasPID && hasReload
}

// showUnit asks systemd for the properties of a unit a handoff reads.
func showUnit(unit string) (string, error) {
	out, err := exec.Command("systemctl", "show", unit, "-p", "PIDFile", "-p", "ExecReload", "-p", "MainPID").Output()
	return string(out), err
}

/*
detectUpgradeMode works out, once at boot, how this Bay can be upgraded. A
unit changed while Bay runs is read by the next process, which is the one a
changed unit applies to anyway.
*/
func detectUpgradeMode(pidFile string, successor bool) string {
	unit := ownUnit()
	if unit == "" {
		return upgradeManual
	}
	show, err := showUnit(unit)
	if err != nil {
		return upgradeManual
	}
	// A successor boots while systemd still names the process that started
	// it; the PID file moves the service to it once that one has left.
	pids := []int{os.Getpid()}
	if successor {
		pids = append(pids, os.Getppid())
	}
	return upgradeModeOf(show, pidFile, pids...)
}

/*
upgradeModeOf reads `systemctl show` of the unit whose cgroup this process is
in.

The cgroup alone does not make it Bay's unit. A Bay started by hand from a
shell that another service spawned (a CI runner, an sshd that keeps its
sessions in its own cgroup) is in that service's cgroup, and is not what
systemd supervises there: the unit's main process is somebody else. Only a
unit whose MainPID is this process, or the one this process is taking over
from, is the unit that runs Bay.
*/
func upgradeModeOf(show, pidFile string, pids ...int) string {
	mainPID := 0
	for _, line := range strings.Split(show, "\n") {
		if value, ok := strings.CutPrefix(strings.TrimSpace(line), "MainPID="); ok {
			mainPID, _ = strconv.Atoi(value)
		}
	}
	ours := false
	for _, pid := range pids {
		ours = ours || (mainPID > 0 && pid == mainPID)
	}
	switch {
	case !ours:
		return upgradeManual
	case dropInInEffect(show, pidFile):
		return upgradeHandoff
	default:
		return upgradeRestart
	}
}
