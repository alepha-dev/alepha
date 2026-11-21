package main

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/connector"
)

// Every verb `serve` runs, and one it does not know: a monitor-only Bay
// refuses them all, on the machine, whatever Lore sends (#Q4002).
func TestAgentRefusesEveryVerb(t *testing.T) {
	h := monitorHandler{log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	kinds := []actionKind{
		actionDeploy, actionStackDeploy, actionRestart, actionStop, actionStart,
		actionBackup, actionRestore, actionRemove, actionStackRemove,
		actionBackupPolicy, actionUpgrade, actionLogs, actionBackupsList,
		actionBackupVerify, actionTargetProbe, "exec",
	}
	for _, kind := range kinds {
		var acks []connector.Ack
		h.Command(context.Background(), connector.Command{ID: "c-" + string(kind), Kind: string(kind)},
			func(a connector.Ack) error { acks = append(acks, a); return nil })
		if len(acks) != 1 || acks[0].Status != "failed" || !strings.Contains(acks[0].Reason, "monitor-only") {
			t.Fatalf("%s: want one failed ack naming monitor-only, got %+v", kind, acks)
		}
	}
	inv, ok := h.Inventory(context.Background())
	if !ok || len(inv.Apps) != 0 || inv.Apps == nil {
		t.Fatalf("the inventory is the host alone, an empty app list: %+v", inv)
	}
}

// The agent never listens: it has no proxy, no TLS, no ACME, no control
// socket and no Docker, so none of what opens them appears in its code.
func TestAgentOpensNoListener(t *testing.T) {
	src, err := os.ReadFile("agent.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, banned := range []string{"Listen(", "tableflip", "tlsconf", "runner.", "controlSocket", "http.Server"} {
		if strings.Contains(string(src), banned) {
			t.Fatalf("agent.go must not reach %q: a monitor-only Bay opens nothing", banned)
		}
	}
}

// End to end against the stub Lore: the inventory says `mode: monitor` with
// no app, and a deploy pushed anyway is refused machine-side.
func TestIntegrationAgentReportsAndRefuses(t *testing.T) {
	root := t.TempDir()
	lore := newStubLore(t)
	lore.setDeployAllowed(true)
	if err := connector.NewStore(root).Set(connector.Config{Sink: lore.srv.URL, Secret: testSecret}); err != nil {
		t.Fatal(err)
	}
	client := newAgentClient(root, slog.New(slog.NewTextHandler(io.Discard, nil)))
	client.MinBackoff, client.MaxBackoff = 5*time.Millisecond, 20*time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { client.Run(ctx); close(done) }()
	t.Cleanup(func() { cancel(); <-done })

	s := lore.session(t)
	client.KickInventory()
	deadline := time.After(10 * time.Second)
	for inventory := false; !inventory; {
		select {
		case f, ok := <-s.frames:
			if !ok {
				t.Fatal("session closed before an inventory")
			}
			if f["type"] != "inventory" {
				continue
			}
			inventory = true
			host, _ := f["host"].(map[string]any)
			if host["mode"] != "monitor" {
				t.Fatalf("inventory host mode: want monitor, got %v", host["mode"])
			}
			if apps, _ := f["apps"].([]any); len(apps) != 0 {
				t.Fatalf("a monitor reports no app, got %v", apps)
			}
		case <-deadline:
			t.Fatal("no inventory arrived")
		}
	}

	s.push(t, deployOf(t, "44444444-4444-4444-8444-444444444444", []byte("x")))
	ack := s.ack(t, "44444444-4444-4444-8444-444444444444", "failed")
	if !strings.Contains(ack["reason"].(string), "monitor-only") {
		t.Fatalf("the refusal names the mode: %v", ack["reason"])
	}
	if entries, _ := os.ReadDir(filepath.Join(root, "apps")); len(entries) != 0 {
		t.Fatal("a monitor-only Bay must write no app")
	}
}
