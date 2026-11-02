package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/alepha-dev/bay/internal/connector"
)

func backupCmd(id, kind string) connector.Command {
	return connector.Command{ID: id, Kind: kind, App: "demo", Environment: "production"}
}

func (s *fakeSink) lastJSON(t *testing.T, into any) {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.uploaded) == 0 {
		t.Fatal("nothing was uploaded")
	}
	if err := json.Unmarshal(s.uploaded[len(s.uploaded)-1], into); err != nil {
		t.Fatalf("upload: %v", err)
	}
}

func TestBackupsListUploadsTheCatalogNewestFirst(t *testing.T) {
	f, _, _ := bundleFixture(t)
	sink := enrolled(t, f)
	for i := 0; i < 2; i++ {
		if rec := f.backup(t); rec.Code != http.StatusOK {
			t.Fatalf("backup: %d %s", rec.Code, rec.Body)
		}
	}
	acts := newActions(f.server)
	rec := &ackRecorder{}
	acts.Command(context.Background(), backupCmd("c-list", "backups-list"), rec.send)
	if last := rec.last(); last.Status != "done" {
		t.Fatalf("ack: %+v", last)
	}
	var out backupsListResult
	sink.lastJSON(t, &out)
	if out.Catalog.Count != len(out.Backups) || len(out.Backups) == 0 {
		t.Fatalf("listing: %+v", out)
	}
	for i := 1; i < len(out.Backups); i++ {
		if out.Backups[i-1].At < out.Backups[i].At {
			t.Fatalf("newest first: %+v", out.Backups)
		}
	}
}

func TestBackupPolicyActionSetsAndClearsTheOperatorLayer(t *testing.T) {
	f, _, _ := bundleFixture(t)
	spool := withEvents(t, f)
	acts := newActions(f.server)

	cmd := backupCmd("c-pol", "backup-policy")
	cmd.Policy = json.RawMessage(`{"enabled":true,"schedule":{"every":"2h"}}`)
	rec := &ackRecorder{}
	acts.Command(context.Background(), cmd, rec.send)
	if last := rec.last(); last.Status != "failed" || !strings.Contains(last.Reason, "deployAllowed") {
		t.Fatalf("refused while the estate forbids writes: %+v", last)
	}

	acts.Welcome(connector.Welcome{DeployAllowed: true})
	cmd.ID = "c-pol-2"
	rec = &ackRecorder{}
	acts.Command(context.Background(), cmd, rec.send)
	if last := rec.last(); last.Status != "done" || !strings.Contains(last.Reason, "every 2h") {
		t.Fatalf("set: %+v", last)
	}
	if p := f.server.effectiveBackupPolicy(f.app(t)); !p.Enabled || p.Every.Hours() != 2 || p.Sources.Schedule != "operator" {
		t.Fatalf("effective: %+v", p)
	}
	if !hasKind(spool, "backup.policy-changed") {
		t.Fatalf("events: %v", eventKinds(spool))
	}

	bad := backupCmd("c-pol-3", "backup-policy")
	bad.Policy = json.RawMessage(`{"schedule":{"every":"soon"}}`)
	rec = &ackRecorder{}
	acts.Command(context.Background(), bad, rec.send)
	if last := rec.last(); last.Status != "failed" || !strings.HasPrefix(last.Reason, "policy:") {
		t.Fatalf("an invalid policy is refused with the reason: %+v", last)
	}

	clear := backupCmd("c-pol-4", "backup-policy")
	clear.Policy = json.RawMessage(`null`)
	rec = &ackRecorder{}
	acts.Command(context.Background(), clear, rec.send)
	if last := rec.last(); last.Status != "done" || !strings.Contains(last.Reason, "cleared") {
		t.Fatalf("clear: %+v", last)
	}
	if f.app(t).BackupOverride != nil {
		t.Fatal("the operator layer is gone")
	}
}

func TestRestoreActionNeedsAReasonAndRecordsIt(t *testing.T) {
	f, _, _ := bundleFixture(t)
	sink := enrolled(t, f)
	if rec := f.backup(t); rec.Code != http.StatusOK {
		t.Fatalf("backup: %d %s", rec.Code, rec.Body)
	}
	acts := newActions(f.server)
	acts.Welcome(connector.Welcome{DeployAllowed: true})

	rec := &ackRecorder{}
	acts.Command(context.Background(), backupCmd("c-r1", "restore"), rec.send)
	if last := rec.last(); last.Status != "failed" || !strings.Contains(last.Reason, "reason") {
		t.Fatalf("a restore without a reason is refused: %+v", last)
	}

	dry := backupCmd("c-r2", "restore")
	dry.Restore = &connector.RestoreAsk{DryRun: true}
	rec = &ackRecorder{}
	acts.Command(context.Background(), dry, rec.send)
	if last := rec.last(); last.Status != "done" || !strings.Contains(last.Reason, "dry run") {
		t.Fatalf("dry run: %+v", last)
	}
	var plan map[string]any
	sink.lastJSON(t, &plan)
	if plan["wouldRestore"] == nil || f.app(t).LastRestore != nil {
		t.Fatalf("a dry run says what it would do and records nothing: %v", plan)
	}

	real := backupCmd("c-r3", "restore")
	real.Restore = &connector.RestoreAsk{Reason: "bad migration"}
	rec = &ackRecorder{}
	acts.Command(context.Background(), real, rec.send)
	if last := rec.last(); last.Status != "done" || !strings.Contains(last.Reason, "backed up as") {
		t.Fatalf("restore: %+v", last)
	}
	if r := f.app(t).LastRestore; r == nil || r.Trigger != "console" || r.Reason != "bad migration" {
		t.Fatalf("recorded: %+v", r)
	}
}

func TestRestoreActionIsRefusedWhenTheEstateForbidsWrites(t *testing.T) {
	f := deployedApp(t)
	cmd := backupCmd("c-r", "restore")
	cmd.Restore = &connector.RestoreAsk{Reason: "x"}
	rec := &ackRecorder{}
	newActions(f.server).Command(context.Background(), cmd, rec.send)
	if last := rec.last(); last.Status != "failed" || !strings.Contains(last.Reason, "deployAllowed") {
		t.Fatalf("%+v", last)
	}
}

func TestBackupActionsRefuseAnInstanceWithoutADatabase(t *testing.T) {
	f := deployedApp(t)
	app := f.app(t)
	app.Backups = false
	if err := f.server.store.Upsert(app); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"backups-list", "backup-verify", "target-probe", "backup-policy"} {
		rec := &ackRecorder{}
		newActions(f.server).Command(context.Background(), backupCmd("c-"+kind, kind), rec.send)
		if last := rec.last(); last.Status != "failed" || !strings.Contains(last.Reason, "no database") {
			t.Errorf("%s: %+v", kind, last)
		}
	}
}
