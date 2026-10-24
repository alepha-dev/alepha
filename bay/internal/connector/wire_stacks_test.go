package connector

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

/*
The stack frames, kept apart from testdata/wire-v1: Lore's copy of wire-v1 is
validated against its schemas, and these frames reach Lore with its stacks
epic, which copies testdata/stacks in the same change.
*/
func stackFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "stacks", name))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestWireStackFrames(t *testing.T) {
	t.Run("a stack-deploy names a stack environment and a bundle by digest", func(t *testing.T) {
		frame, err := decodeFrame(stackFixture(t, "command-stack-deploy.json"))
		if err != nil {
			t.Fatal(err)
		}
		if frame.Kind != "stack-deploy" || frame.Stack != "umami" || frame.Environment != "production" ||
			frame.Artifact == nil || len(frame.Artifact.SHA256) != 64 || frame.Revision != 0 {
			t.Fatalf("decoded = %+v", frame)
		}
	})

	t.Run("a rollback names a revision and no bundle", func(t *testing.T) {
		frame, err := decodeFrame(stackFixture(t, "command-stack-rollback.json"))
		if err != nil {
			t.Fatal(err)
		}
		if frame.Kind != "stack-deploy" || frame.Revision != 3 || frame.Artifact != nil {
			t.Fatalf("decoded = %+v", frame)
		}
	})

	t.Run("an inventory carries stack environments and member rows, and round-trips", func(t *testing.T) {
		raw := stackFixture(t, "inventory-stacks.json")
		var inv Inventory
		if err := json.Unmarshal(raw, &inv); err != nil {
			t.Fatal(err)
		}
		if len(inv.Stacks) != 1 || inv.Stacks[0].TCP[0] != 8883 || inv.Apps[0].ServiceKind != "service" || inv.Apps[0].Stack != "umami" {
			t.Fatalf("inventory = %+v", inv)
		}
		out, _ := json.Marshal(inv)
		var a, b map[string]any
		_ = json.Unmarshal(raw, &a)
		_ = json.Unmarshal(out, &b)
		if a["stacks"] == nil || b["stacks"] == nil {
			t.Fatalf("stacks lost in the round trip: %s", out)
		}
	})

	t.Run("an inventory with no stack writes no stacks key, as Lore's v1 expects", func(t *testing.T) {
		out, _ := json.Marshal(Inventory{Type: "inventory", Apps: []InventoryApp{{App: "a", Env: "production"}}})
		var m map[string]any
		_ = json.Unmarshal(out, &m)
		if _, ok := m["stacks"]; ok {
			t.Fatalf("stacks written for a host with none: %s", out)
		}
		row := m["apps"].([]any)[0].(map[string]any)
		if _, ok := row["stack"]; ok {
			t.Fatalf("a standalone row carries stack fields: %s", out)
		}
	})
}
