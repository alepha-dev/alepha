package connector

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

/*
The wire format, pinned from both sides.

testdata/wire-v1 holds one frame of each kind, as Lore's `$channel` schemas
accept and emit them. This file proves the Go structs read and write exactly
those bytes; `apps/lore/test/estate-wire-format.spec.ts` proves the same
files validate against Lore's zod schemas. The two suites read the same
fixtures, so the vocabulary cannot drift on one side without the other
noticing.
*/

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "wire-v1", name))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func asMap(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestWireServerFramesDecode(t *testing.T) {
	welcome, err := decodeFrame(fixture(t, "welcome.json"))
	if err != nil {
		t.Fatal(err)
	}
	if welcome.Type != "welcome" || welcome.Protocol != Protocol || welcome.Estate.Slug != "ovh-1" ||
		welcome.DeployAllowed || welcome.StatsIntervalSeconds != 1800 ||
		!hasFeature(welcome.Features, EventsFeature) {
		t.Fatalf("welcome decoded wrong: %+v", welcome)
	}

	config, err := decodeFrame(fixture(t, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if config.Type != "config" || !config.DeployAllowed || config.StatsIntervalSeconds != 300 {
		t.Fatalf("config decoded wrong: %+v", config)
	}

	restart, err := decodeFrame(fixture(t, "command-restart.json"))
	if err != nil {
		t.Fatal(err)
	}
	if restart.Type != "command" || restart.Kind != "restart" || restart.App != "lore" ||
		restart.Environment != "production" || restart.Artifact != nil {
		t.Fatalf("restart decoded wrong: %+v", restart)
	}

	deploy, err := decodeFrame(fixture(t, "command-deploy.json"))
	if err != nil {
		t.Fatal(err)
	}
	if deploy.Kind != "deploy" || deploy.Artifact == nil || len(deploy.Artifact.SHA256) != 64 || deploy.Artifact.Size != 1234 {
		t.Fatalf("deploy decoded wrong: %+v", deploy)
	}

	// The verbs that name one instance and nothing else. They carry the same
	// shape as a restart and no artifact: nothing here takes a path, a shell
	// command or an argument list. A `remove` carries no purge either: there
	// is no field for one (folio #F1455 of the Alepha project).
	for _, name := range []string{"command-stop.json", "command-start.json", "command-backup.json", "command-remove.json"} {
		frame, err := decodeFrame(fixture(t, name))
		if err != nil {
			t.Fatal(err)
		}
		want := name[len("command-") : len(name)-len(".json")]
		if frame.Type != "command" || frame.Kind != want ||
			frame.App == "" || frame.Environment == "" || frame.Artifact != nil {
			t.Fatalf("%s decoded wrong: %+v", name, frame)
		}
	}

	// The one command that carries an ask. Bounded numbers and a bounded
	// pattern, and still no path and no argument list.
	logs, err := decodeFrame(fixture(t, "command-logs.json"))
	if err != nil {
		t.Fatal(err)
	}
	if logs.Kind != "logs" || logs.Logs == nil || logs.Logs.Lines != 500 ||
		logs.Logs.SinceSeconds != 900 || logs.Logs.Grep != "ERROR" {
		t.Fatalf("logs decoded wrong: %+v", logs.Logs)
	}

	// The backup verbs that carry an ask: the point to restore and why, and
	// an operator policy passed through as raw JSON for Bay to validate.
	restore, err := decodeFrame(fixture(t, "command-restore.json"))
	if err != nil {
		t.Fatal(err)
	}
	if restore.Kind != "restore" || restore.Restore == nil ||
		restore.Restore.Key != "lore/production/2026/11/01/030000Z.tar.zst" ||
		restore.Restore.Reason == "" || restore.Restore.DryRun {
		t.Fatalf("restore decoded wrong: %+v", restore.Restore)
	}
	policy, err := decodeFrame(fixture(t, "command-backup-policy.json"))
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]any
	if policy.Kind != "backup-policy" || json.Unmarshal(policy.Policy, &parsed) != nil ||
		parsed["schedule"] == nil || parsed["retention"] == nil {
		t.Fatalf("backup-policy decoded wrong: %s", policy.Policy)
	}

	// A refresh: a type and nothing else. A field here would make it a
	// request with arguments, which is the shape that becomes a command.
	query, err := decodeFrame(fixture(t, "query.json"))
	if err != nil {
		t.Fatal(err)
	}
	if query.Type != "query" || query.ID != "" || query.Kind != "" || query.Artifact != nil {
		t.Fatalf("query decoded wrong: %+v", query)
	}
}

func TestWireClientFramesEncode(t *testing.T) {
	cases := []struct {
		name  string
		frame any
	}{
		{"hello.json", map[string]string{"type": "hello"}},
		{"ack-running.json", NewAck("3e9a1c7b-5d2f-4b8a-9c6e-7f1d2a3b4c5d", "running", "downloading", "")},
		{"ack-done.json", NewAck("0b6d3f2e-7a41-4d9c-b2e5-1c8f9a7d6e54", "done", "", "")},
		{"ack-deploy-done.json", func() Ack {
			ack := NewAck("0b6d3f2e-7a41-4d9c-b2e5-1c8f9a7d6e54", "done", "", "")
			ack.URL = "https://demo-production.bay.example.com/"
			ack.AppSecretSource = "minted"
			ack.Warning = "demo/production runs on a NEW APP_SECRET over data restored from a backup that carried none"
			return ack
		}()},
		{"ack-failed.json", NewAck("3e9a1c7b-5d2f-4b8a-9c6e-7f1d2a3b4c5d", "failed", "verifying",
			"artifact digest mismatch: got 0123456789ab…, expected 9f86d081884c…")},
		{"stats.json", Stats{Type: "stats", CPUPercent: 34.5, MemoryPercent: 61, At: "2026-09-05T12:00:00Z"}},
		{"inventory.json", sampleInventoryFrame()},
		{"event.json", Event{
			Type: "event", ID: "evt-01JB6Q3V9W2X5Y7Z8A1B2C3D4E", Kind: "backup.failed",
			At: "2026-11-01T03:00:12Z", App: "lore", Env: "production",
			Data: map[string]any{"stage": "upload", "error": "s3: connection refused", "consecutive": 2},
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			encoded, err := json.Marshal(c.frame)
			if err != nil {
				t.Fatal(err)
			}
			if got, want := asMap(t, encoded), asMap(t, fixture(t, c.name)); !reflect.DeepEqual(got, want) {
				t.Fatalf("encoded %s\nwant    %s", encoded, fixture(t, c.name))
			}
		})
	}
}

// ptr is the shape every optional reading takes on the wire: absent when the
// supervisor knows nothing, present even when what it knows is zero.
func ptr[T any](v T) *T { return &v }

/*
sampleInventoryFrame is the fixture as Go builds it.

Four rows on purpose, because each one is a rule: a healthy app, a static site
that is `running: false` forever and healthy, an instance stopped on purpose
(`inactive` WITH the intent), and one that crashed past its restart limit
(`failed`, without it). A fixture of four happy apps would pin nothing.
*/
func sampleInventoryFrame() Inventory {
	return Inventory{
		Type: "inventory",
		At:   "2026-09-06T12:00:00Z",
		Host: Host{
			Cores:          ptr(4),
			MemTotalBytes:  ptr(uint64(8232062976)),
			MemUsedBytes:   ptr(uint64(5583457484)),
			DiskTotalBytes: ptr(uint64(168874086400)),
			DiskUsedBytes:  ptr(uint64(42877714432)),
			Load1:          ptr(0.52),
			UptimeSeconds:  ptr(uint64(1234567)),
			BayVersion:     "0.31.0",
		},
		Apps: []InventoryApp{
			{
				App: "lore", Env: "production", Runtime: "node",
				Release: "r-2026-09-06-1", Port: 41001,
				Domains: []string{"lore.alepha.dev", "www.lore.alepha.dev"},
				Running: true, State: "active",
				Restarts: ptr(0), StartedAt: "2026-09-04T08:12:00Z",
				MemoryBytes: ptr(int64(268435456)), CPUSeconds: ptr(4821.5), Tasks: ptr(23),
				Backups: true, LastBackupAt: "2026-09-06T03:00:00Z",
				LastRequestAt: "2026-09-06T11:59:41Z", Crons: 3,
				Problems: []string{},
				Backup: &InventoryBackup{
					State: "ok",
					Policy: &InventoryBackupPolicy{
						Enabled: true, Schedule: "every 6h", Retention: "7 daily, 4 weekly, 6 monthly",
						EverySecs: 21600, Timezone: "Europe/Paris", OnDeploy: true, Prune: "after-backup",
						VerifyEvery: 604800,
						Sources:     map[string]string{"schedule": "operator", "retention": "app"},
					},
					Target: &InventoryBackupTarget{
						Status: "ok", Since: "2026-09-01T00:00:00Z", LastProbeAt: "2026-09-06T11:55:00Z",
						Bucket: "lore-backups",
					},
					NextAt: "2026-09-06T15:00:00Z",
					Last: &InventoryBackupRun{
						At: "2026-09-06T09:00:00Z", Key: "apps/lore-production/db/20260906T090000Z/manifest.json",
						Kind: "bundle", Trigger: "schedule", Tag: "pre-upgrade", Release: "r-2026-09-06-1",
						RawBytes: 52428800, StoredBytes: 9437184, DurationMs: 2140, Files: 1,
						Databases: []InventoryDatabase{{
							Path: "app.db", RawBytes: 52428800, StoredBytes: 9437184,
							SHA256:    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
							Integrity: "ok", Tables: 42, Pages: 12800, PageSize: 4096, JournalMode: "wal",
							TopTables:  []InventoryTableRows{{Table: "deals", Rows: 18234}},
							Migrations: []InventoryMigration{{Table: "migrations", Count: 31, Last: "20260901_brave_lions"}},
						}},
						Anomalies: []string{"deals shrank by 62% since the previous backup"},
					},
					Catalog: &InventoryBackupCatalog{
						ListedAt: "2026-09-06T09:00:05Z", Count: 38, TotalBytes: 358612992,
						OldestAt: "2026-03-06T03:00:00Z", NewestAt: "2026-09-06T09:00:00Z",
					},
					Verify: &InventoryBackupVerify{
						At: "2026-09-05T04:00:00Z", Key: "apps/lore-production/db/20260905T030000Z/manifest.json", OK: true,
					},
					Restore: &InventoryRestore{
						At: "2026-08-20T10:12:00Z", Key: "apps/lore-production/db/20260820T030000Z/manifest.json",
						Reason: "rows deleted by a bad migration", Trigger: "console", Status: "done",
						PreRestoreKey: "apps/lore-production/db/20260820T101155Z/manifest.json",
					},
					NotCovered: []string{"uploads/ (files outside the database)"},
				},
			},
			{
				App: "docs", Env: "production", Runtime: "static",
				Release: "r-2026-08-30-2", Domains: []string{"alepha.dev"},
				Running: false, State: "inactive", Static: true,
				Backups: false, LastRequestAt: "2026-09-06T11:58:03Z",
				Problems: []string{},
			},
			{
				App: "shop", Env: "staging", Runtime: "node",
				Release: "r-2026-08-11-1", Port: 41004,
				Running: false, State: "inactive", Stopped: true,
				Backups: true, LastBackupAt: "2026-08-11T03:00:00Z", BackupStale: true,
				Problems: []string{"backup is stale"},
			},
			{
				App: "api", Env: "production", Runtime: "node",
				Release: "r-2026-09-01-3", Port: 41007,
				Domains: []string{"api.alepha.dev"},
				Running: false, State: "failed", Restarts: ptr(5),
				Backups: true, LastBackupAt: "2026-09-06T03:00:00Z",
				LastBackupError: "2026-09-06T03:00:12Z: upload to s3 failed: 503",
				LastRequestAt:   "2026-09-06T09:14:22Z",
				Problems: []string{
					"not running",
					"restarted 5 time(s)",
					"last backup attempt failed: 2026-09-06T03:00:12Z: upload to s3 failed: 503",
				},
				Backup: &InventoryBackup{
					State:  "failing",
					Target: &InventoryBackupTarget{Status: "down", Since: "2026-09-06T02:45:00Z", LastError: "upload to s3 failed: 503"},
					Failure: &InventoryBackupFailure{
						At: "2026-09-06T03:00:12Z", Stage: "upload", Message: "upload to s3 failed: 503", Consecutive: 3,
					},
					Verify:         &InventoryBackupVerify{At: "2026-09-04T04:00:00Z", OK: false, Error: "app.db: integrity check failed"},
					RestorePending: &InventoryRestorePending{Since: "2026-09-06T08:00:00Z", Reason: "interrupted restore"},
				},
			},
		},
	}
}

/*
An absent reading and a zero one are different frames.

The one rule the fixture cannot pin on its own: `restarts: 0` in the healthy
row is a supervisor that measured zero restarts, and an app with no supervisor
at all must not encode the same bytes.
*/
func TestInventoryDistinguishesAbsentFromZero(t *testing.T) {
	measured := InventoryApp{App: "a", Env: "e", Restarts: ptr(0), Problems: []string{}}
	unknown := InventoryApp{App: "a", Env: "e", Problems: []string{}}
	withZero, err := json.Marshal(measured)
	if err != nil {
		t.Fatal(err)
	}
	without, err := json.Marshal(unknown)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(withZero), `"restarts":0`) {
		t.Fatalf("a measured zero must reach the wire: %s", withZero)
	}
	if strings.Contains(string(without), "restarts") {
		t.Fatalf("an unsupervised app must say nothing about restarts: %s", without)
	}
	// `problems` is a list even when empty: an empty one means nothing here
	// needs a human, and null would mean the machine did not say.
	if !strings.Contains(string(without), `"problems":[]`) {
		t.Fatalf("problems must be a list, never null: %s", without)
	}
}

func TestNewAckStaysWithinWhatLoreAccepts(t *testing.T) {
	ack := NewAck("id", "failed", strings.Repeat("s", 40), strings.Repeat("r", 3000))
	if n := len([]rune(ack.Step)); n != MaxAckStep {
		t.Fatalf("step cut to %d runes, want %d", n, MaxAckStep)
	}
	if n := len([]rune(ack.Reason)); n != MaxAckReason {
		t.Fatalf("reason cut to %d runes, want %d", n, MaxAckReason)
	}
	if !strings.HasSuffix(ack.Reason, "…") {
		t.Fatal("a cut must be visible")
	}
	if short := NewAck("id", "done", "stop", "fine"); short.Step != "stop" || short.Reason != "fine" {
		t.Fatalf("text within the limits must pass untouched: %+v", short)
	}
}
