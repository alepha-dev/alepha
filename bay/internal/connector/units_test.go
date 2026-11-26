package connector

import (
	"context"
	"io"
	"log/slog"
	"reflect"
	"testing"
)

func TestWatchableUnitsKeepsUnitNamesOnly(t *testing.T) {
	got := WatchableUnits([]string{
		"acme-api", "caddy.service", "caddy", "--now", "-x", "a b",
		"getty@tty1.service", "", "timer.timer",
	})
	want := []string{"acme-api.service", "caddy.service", "getty@tty1.service", "timer.timer"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestWatchableUnitsIsBounded(t *testing.T) {
	names := []string{}
	for i := 0; i < 30; i++ {
		names = append(names, "unit"+string(rune('a'+i%26))+string(rune('a'+i/26)))
	}
	if got := len(WatchableUnits(names)); got != MaxWatchedUnits {
		t.Fatalf("kept %d units, want %d", got, MaxWatchedUnits)
	}
}

func TestParseSystemctlShow(t *testing.T) {
	raw := "Id=acme-api.service\nLoadState=loaded\nActiveState=activating\nSubState=start\nStateChangeTimestamp=@1764111447\n\n" +
		"Id=nope.service\nLoadState=not-found\nActiveState=inactive\nSubState=dead\nStateChangeTimestamp=\n\n" +
		"Id=caddy.service\nLoadState=loaded\nActiveState=active\nSubState=running\nStateChangeTimestamp=@1764000000\n"
	got := parseSystemctlShow(raw, []string{"acme-api.service", "nope.service", "caddy.service"})
	want := []UnitState{
		{Name: "acme-api.service", ActiveState: "activating", SubState: "start", Since: "2025-11-25T22:57:27Z"},
		{Name: "nope.service", ActiveState: "not-found"},
		{Name: "caddy.service", ActiveState: "active", SubState: "running", Since: "2025-11-24T16:00:00Z"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}
}

// A fake reader whose answer the test moves between polls.
type fakeUnits struct{ states []UnitState }

func (f *fakeUnits) read(_ context.Context, units []string) ([]UnitState, error) {
	return append([]UnitState(nil), f.states...), nil
}

func TestPollUnitsSpoolsAChangeOnlyAfterTheFirstReading(t *testing.T) {
	spool := NewEventSpool(t.TempDir(), 0)
	fake := &fakeUnits{states: []UnitState{{Name: "api.service", ActiveState: "active", SubState: "running"}}}
	c := &Client{
		Events: spool,
		Units:  fake.read,
		Log:    slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	c.SetWatchedUnits([]string{"api"})

	c.pollUnits(context.Background())
	if n := len(spool.Pending()); n != 0 {
		t.Fatalf("first reading spooled %d events, want none", n)
	}
	if got := c.unitStates(); len(got) != 1 || got[0].ActiveState != "active" {
		t.Fatalf("states after first reading: %+v", got)
	}

	fake.states = []UnitState{{Name: "api.service", ActiveState: "activating", SubState: "start", Since: "2026-11-26T09:00:00Z"}}
	c.pollUnits(context.Background())
	pending := spool.Pending()
	if len(pending) != 1 {
		t.Fatalf("spooled %d events, want 1", len(pending))
	}
	ev := pending[0]
	if ev.Kind != UnitChangedEvent || ev.Data["unit"] != "api.service" || ev.Data["from"] != "active" ||
		ev.Data["to"] != "activating" || ev.Data["toSub"] != "start" || ev.Data["since"] != "2026-11-26T09:00:00Z" {
		t.Fatalf("event %+v", ev)
	}

	// The same reading again is no change.
	c.pollUnits(context.Background())
	if n := len(spool.Pending()); n != 1 {
		t.Fatalf("an unchanged reading spooled: %d events", n)
	}
}

func TestPollUnitsWithNothingWatchedClearsTheStates(t *testing.T) {
	fake := &fakeUnits{states: []UnitState{{Name: "api.service", ActiveState: "active"}}}
	c := &Client{Units: fake.read, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	c.SetWatchedUnits([]string{"api"})
	c.pollUnits(context.Background())
	c.SetWatchedUnits(nil)
	c.pollUnits(context.Background())
	if got := c.unitStates(); got != nil {
		t.Fatalf("states with nothing watched: %+v", got)
	}
}
