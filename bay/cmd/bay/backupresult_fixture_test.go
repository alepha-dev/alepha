package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/alepha-dev/bay/internal/connector"
)

/*
The backup answers, pinned from both sides, as `logs-result.json` is.

Each verb that uploads runs here against a real bundle and a fake bucket, and
what it uploads must not carry a field its fixture under
`testdata/backup-results/` lacks. Lore's `host-backup-results.spec.ts`
parses the same files (copied to `fixtures/bay/backup-results/`) and asserts
it strips nothing, so a field Bay starts sending without Lore's schema knowing
it goes red here first, and a field Lore stops reading goes red there.

BAY_UPDATE_FIXTURES=1 rewrites the fixtures from what the verbs send today.
The committed ones also carry, by hand, the optional fields a happy run leaves
out (a tag, a truncated listing, a failing probe), so Lore's schema is held to
those too: put them back after a rewrite, then copy the files to Lore.
*/
func TestBackupResultsMatchTheSharedFixtures(t *testing.T) {
	f, _, _ := bundleFixture(t)
	sink := enrolled(t, f)
	f.server.targets = newTargetHealth()
	for i := 0; i < 2; i++ {
		if rec := f.backup(t); rec.Code != http.StatusOK {
			t.Fatalf("backup: %d %s", rec.Code, rec.Body)
		}
	}
	acts := newActions(f.server)
	acts.Welcome(connector.Welcome{DeployAllowed: true})

	dry := backupCmd("c-dry", "restore")
	dry.Restore = &connector.RestoreAsk{DryRun: true}
	runs := []struct {
		file string
		cmd  connector.Command
	}{
		{"backups-list.json", backupCmd("c-list", "backups-list")},
		{"backup-verify.json", backupCmd("c-verify", "backup-verify")},
		{"target-probe.json", backupCmd("c-probe", "target-probe")},
		{"restore-dry-run.json", dry},
	}
	for _, run := range runs {
		t.Run(run.file, func(t *testing.T) {
			rec := &ackRecorder{}
			acts.Command(context.Background(), run.cmd, rec.send)
			if last := rec.last(); last.Status != "done" {
				t.Fatalf("ack: %+v", last)
			}
			var sent any
			sink.lastJSON(t, &sent)
			path := filepath.Join("testdata", "backup-results", run.file)
			if os.Getenv("BAY_UPDATE_FIXTURES") == "1" {
				raw, err := json.MarshalIndent(sent, "", "  ")
				if err != nil {
					t.Fatal(err)
				}
				if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, append(raw, '\n'), 0o644); err != nil {
					t.Fatal(err)
				}
				return
			}
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var pinned any
			if err := json.Unmarshal(raw, &pinned); err != nil {
				t.Fatal(err)
			}
			if extra := unknownFields("", sent, pinned); len(extra) > 0 {
				t.Fatalf("%s sends fields its shared fixture lacks: %s", run.file, strings.Join(extra, ", "))
			}
		})
	}
}

/*
unknownFields lists the object keys in got that want does not have, at any
depth. Arrays are compared element-wise against the fixture's first element,
which is the shape every entry of a list shares.
*/
func unknownFields(at string, got, want any) []string {
	var out []string
	switch g := got.(type) {
	case map[string]any:
		w, _ := want.(map[string]any)
		for k, v := range g {
			wv, ok := w[k]
			if !ok {
				out = append(out, at+"."+k)
				continue
			}
			out = append(out, unknownFields(at+"."+k, v, wv)...)
		}
	case []any:
		w, _ := want.([]any)
		if len(w) == 0 {
			if len(g) > 0 {
				out = append(out, at+"[]")
			}
			break
		}
		for _, v := range g {
			out = append(out, unknownFields(at+"[]", v, w[0])...)
		}
	}
	sort.Strings(out)
	return out
}
