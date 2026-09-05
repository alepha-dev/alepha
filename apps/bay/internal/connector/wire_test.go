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
