package main

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/state"
)

/*
The socket handoff, on the real binary (#Q3743).

`bay serve` is built from this checkout and run as a process, because the
handoff is one process starting another from os.Args[0] and passing it file
descriptors: nothing short of two real processes exercises it. Docker must
answer, as for any `bay serve`.
*/
type handoffBay struct {
	t       *testing.T
	root    string
	run     string // the runtime directory, where bay.pid is written
	socket  string
	addr    string
	tcpPort int
	log     *fileLog
	cmd     *exec.Cmd
}

/*
fileLog is the output of every bay of a test, old and new.

A file, not a buffer: given anything but a file, exec waits in Wait for the
writer to see the end of the output, and a successor that inherited the pipe
keeps it open for as long as it lives.
*/
type fileLog struct{ path string }

func (l *fileLog) String() string {
	raw, _ := os.ReadFile(l.path)
	return string(raw)
}

// syncBuffer collects what two goroutines report at once.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func freeTCPPort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

// startHandoffBay runs `bay serve` with one raw TCP port forwarded to
// `tcpTarget`, and waits for it to answer.
func startHandoffBay(t *testing.T, tcpTarget int) *handoffBay {
	t.Helper()
	daemonDocker(t)
	dir := t.TempDir()
	// Short: a unix socket path is capped near 104 bytes.
	short, err := os.MkdirTemp("", "bayh")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(short) })
	b := &handoffBay{
		t:       t,
		root:    filepath.Join(dir, "data"),
		run:     filepath.Join(dir, "run"),
		socket:  filepath.Join(short, "c.sock"),
		addr:    "127.0.0.1:" + strconv.Itoa(freeTCPPort(t)),
		tcpPort: freeTCPPort(t),
		log:     &fileLog{path: filepath.Join(dir, "bay.log")},
	}
	for _, d := range []string{b.root, b.run} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	// A stack environment with one raw TCP port, written the way a stack
	// deploy records it: `serve` opens it at boot.
	store, err := state.Open(filepath.Join(b.root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.MutateStackEnv("broker", "production", func(e *state.StackEnv) error {
		e.TCP = map[int]int{b.tcpPort: tcpTarget}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	bin := filepath.Join(dir, "bay")
	if out, err := exec.Command("go", "build", "-o", bin, ".").CombinedOutput(); err != nil {
		t.Fatalf("go build: %v\n%s", err, out)
	}
	b.cmd = exec.Command(bin, "serve", "--root", b.root, "--addr", b.addr, "--control-socket", b.socket)
	b.cmd.Env = append(os.Environ(), "RUNTIME_DIRECTORY="+b.run)
	out, err := os.Create(b.log.path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { out.Close() })
	b.cmd.Stdout, b.cmd.Stderr = out, out
	if err := b.cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		// Whichever process holds the PID file now is the one still serving.
		if pid := b.servingPID(); pid > 0 {
			_ = syscall.Kill(pid, syscall.SIGTERM)
		}
		_ = b.cmd.Process.Kill()
	})
	b.waitFor("the first bay to write its PID file", func() bool { return b.servingPID() == b.cmd.Process.Pid })
	b.waitFor("the proxy to answer", func() bool { return b.get() == nil })
	return b
}

func (b *handoffBay) waitFor(what string, ok func() bool) {
	b.t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if ok() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	b.t.Fatalf("timed out waiting for %s\n%s", what, b.log)
}

func (b *handoffBay) servingPID() int {
	raw, err := os.ReadFile(filepath.Join(b.run, "bay.pid"))
	if err != nil {
		return 0
	}
	pid, _ := strconv.Atoi(strings.TrimSpace(string(raw)))
	return pid
}

// get makes one request on a connection of its own, so every call goes
// through accept: a kept-alive connection would hide a listener that is gone.
func (b *handoffBay) get() error {
	client := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{DisableKeepAlives: true}}
	res, err := client.Get("http://" + b.addr + "/")
	if err != nil {
		return err
	}
	_, _ = io.Copy(io.Discard, res.Body)
	return res.Body.Close()
}

// echo opens the raw TCP port and expects the target's greeting.
func (b *handoffBay) echo() error {
	conn, err := net.DialTimeout("tcp", "127.0.0.1:"+strconv.Itoa(b.tcpPort), 5*time.Second)
	if err != nil {
		return err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	buf := make([]byte, 5)
	if _, err := io.ReadFull(conn, buf); err != nil {
		return err
	}
	return nil
}

// control posts to the control socket and answers the status and the body.
func (b *handoffBay) control(method, path string) (int, string) {
	client := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", b.socket)
		},
	}}
	req, _ := http.NewRequest(method, "http://bay"+path, nil)
	res, err := client.Do(req)
	if err != nil {
		return 0, err.Error()
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(body)
}

// greeter is the service behind the raw TCP port: it greets and hangs up.
func greeter(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				_, _ = conn.Write([]byte("hello"))
			}()
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port
}

func TestHandoffRefusesNoConnectionDaemon(t *testing.T) {
	b := startHandoffBay(t, greeter(t))
	first := b.cmd.Process.Pid
	if err := b.echo(); err != nil {
		t.Fatalf("the raw TCP port before the handoff: %v\n%s", err, b.log)
	}

	// Two loops, one per kind of listener, each opening a connection per
	// attempt for as long as the handoff takes.
	var stop atomic.Bool
	var httpOK, tcpOK atomic.Int64
	var failures syncBuffer
	var loops sync.WaitGroup
	loop := func(name string, attempt func() error, ok *atomic.Int64) {
		defer loops.Done()
		for !stop.Load() {
			if err := attempt(); err != nil {
				failures.Write([]byte(time.Now().Format("15:04:05.000000") + " " + name + ": " + err.Error() + "\n"))
			} else {
				ok.Add(1)
			}
			// Paced: a tight loop of new connections runs the test machine out
			// of local ports long before it says anything about Bay.
			time.Sleep(5 * time.Millisecond)
		}
	}
	loops.Add(2)
	go loop("http", b.get, &httpOK)
	go loop("tcp", b.echo, &tcpOK)

	time.Sleep(300 * time.Millisecond)
	if err := b.cmd.Process.Signal(syscall.SIGHUP); err != nil {
		t.Fatal(err)
	}
	exited := make(chan error, 1)
	go func() { exited <- b.cmd.Wait() }()
	select {
	case err := <-exited:
		if err != nil {
			t.Fatalf("the old bay must leave with status 0: %v\n%s", err, b.log)
		}
	case <-time.After(60 * time.Second):
		t.Fatalf("the old bay never left\n%s", b.log)
	}
	b.waitFor("the new bay to open the control socket", func() bool {
		status, _ := b.control(http.MethodGet, "/apps")
		return status == http.StatusOK
	})
	time.Sleep(300 * time.Millisecond)
	stop.Store(true)
	loops.Wait()

	if failed := failures.String(); failed != "" {
		t.Fatalf("connections failed during the handoff:\n%s\n%s", failed, b.log)
	}
	if httpOK.Load() < 10 || tcpOK.Load() < 10 {
		t.Fatalf("the loops barely ran: %d http, %d tcp", httpOK.Load(), tcpOK.Load())
	}
	second := b.servingPID()
	if second == first || second == 0 {
		t.Fatalf("the PID file must name the new process: %d, was %d", second, first)
	}
	// The new process is not frozen, and a second handoff works from it.
	if status, body := b.control(http.MethodPost, "/connector/reload"); status != http.StatusOK {
		t.Fatalf("a write to the new bay: %d %s", status, body)
	}
	if err := syscall.Kill(second, syscall.SIGHUP); err != nil {
		t.Fatal(err)
	}
	b.waitFor("a third bay to take over", func() bool {
		pid := b.servingPID()
		return pid != second && pid != 0
	})
	b.waitFor("the third bay to answer", func() bool { return b.get() == nil && b.echo() == nil })
}

func TestASuccessorThatCannotServeLeavesTheOldBayServingDaemon(t *testing.T) {
	b := startHandoffBay(t, greeter(t))
	first := b.cmd.Process.Pid
	if err := b.echo(); err != nil {
		t.Fatalf("the raw TCP port before the handoff: %v\n%s", err, b.log)
	}

	// The successor reads the state file at boot, and this one it cannot.
	stateFile := filepath.Join(b.root, "state.json")
	good, err := os.ReadFile(stateFile)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(stateFile, []byte("{ not json"), 0o600); err != nil {
		t.Fatal(err)
	}

	var stop atomic.Bool
	var failures syncBuffer
	var loops sync.WaitGroup
	loops.Add(1)
	go func() {
		defer loops.Done()
		for !stop.Load() {
			if err := b.get(); err != nil {
				failures.Write([]byte(err.Error() + "\n"))
			}
			time.Sleep(5 * time.Millisecond)
		}
	}()

	if err := b.cmd.Process.Signal(syscall.SIGHUP); err != nil {
		t.Fatal(err)
	}
	b.waitFor("the old bay to say the successor did not take over", func() bool {
		return strings.Contains(b.log.String(), "the new process did not take over")
	})
	stop.Store(true)
	loops.Wait()

	if failed := failures.String(); failed != "" {
		t.Fatalf("requests failed while the successor crashed:\n%s\n%s", failed, b.log)
	}
	if !strings.Contains(b.log.String(), "exit status 1") || !strings.Contains(b.log.String(), "state") {
		t.Fatalf("the log must carry the successor's status and its reason:\n%s", b.log)
	}
	if pid := b.servingPID(); pid != first {
		t.Fatalf("the PID file moved to %d, the old bay is %d", pid, first)
	}
	if err := b.echo(); err != nil {
		t.Fatalf("the raw TCP port after the failed handoff: %v\n%s", err, b.log)
	}
	// Unfrozen: the control socket takes a write again.
	if status, body := b.control(http.MethodPost, "/connector/reload"); status != http.StatusOK {
		t.Fatalf("a write after the failed handoff: %d %s\n%s", status, body, b.log)
	}

	// And with a state file it can read, the next handoff goes through.
	if err := os.WriteFile(stateFile, good, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := b.cmd.Process.Signal(syscall.SIGHUP); err != nil {
		t.Fatal(err)
	}
	b.waitFor("the second attempt to take over", func() bool {
		pid := b.servingPID()
		return pid != first && pid != 0
	})
}
