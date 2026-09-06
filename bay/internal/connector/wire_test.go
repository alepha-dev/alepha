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
		welcome.DeployAllowed || welcome.StatsIntervalSeconds != 1800 {
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
		{"ack-failed.json", NewAck("3e9a1c7b-5d2f-4b8a-9c6e-7f1d2a3b4c5d", "failed", "verifying",
			"artifact digest mismatch: got 0123456789ab…, expected 9f86d081884c…")},
		{"stats.json", Stats{Type: "stats", CPUPercent: 34.5, MemoryPercent: 61, At: "2026-09-05T12:00:00Z"}},
		{"inventory.json", sampleInventoryFrame()},
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
