package connector

import (
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// writeConn records what is written and can be made to refuse.
type writeConn struct {
	mu      sync.Mutex
	written []any
	fail    bool
}

func (c *writeConn) ReadJSON(any) error { return io.EOF }
func (c *writeConn) WriteJSON(v any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.fail {
		return errors.New("socket closed")
	}
	c.written = append(c.written, v)
	return nil
}
func (c *writeConn) WriteControl(int, []byte, time.Time) error { return nil }
func (c *writeConn) SetReadDeadline(time.Time) error           { return nil }
func (c *writeConn) SetPongHandler(func(string) error)         {}
func (c *writeConn) Close() error                              { return nil }

func TestEventSpoolPersistsCapsAndRemoves(t *testing.T) {
	root := t.TempDir()
	spool := NewEventSpool(root, 3)
	for i, kind := range []string{"a", "b", "c", "d"} {
		if _, err := spool.Append(kind, "demo", "production", map[string]any{"i": i}); err != nil {
			t.Fatal(err)
		}
	}
	pending := spool.Pending()
	if len(pending) != 3 || pending[0].Kind != "b" || pending[2].Kind != "d" {
		t.Fatalf("past the cap the OLDEST goes: %+v", pending)
	}
	if pending[0].Type != "event" || pending[0].ID == "" || pending[0].At == "" || pending[0].App != "demo" {
		t.Fatalf("an event names its frame type, id, time and instance: %+v", pending[0])
	}

	reopened := NewEventSpool(root, 3)
	if got := reopened.Pending(); len(got) != 3 || got[0].ID != pending[0].ID {
		t.Fatalf("the spool must survive a restart: %+v", got)
	}
	ids := []string{}
	for _, e := range pending {
		ids = append(ids, e.ID)
	}
	if err := reopened.Remove(ids...); err != nil {
		t.Fatal(err)
	}
	if len(reopened.Pending()) != 0 {
		t.Fatal("removed events are gone")
	}
	if _, err := os.Stat(filepath.Join(root, EventsFileName)); !os.IsNotExist(err) {
		t.Fatalf("an empty spool leaves no file: %v", err)
	}
}

func TestNilEventSpoolIsANoOp(t *testing.T) {
	var spool *EventSpool
	if _, err := spool.Append("x", "a", "b", nil); err != nil {
		t.Fatal(err)
	}
	if spool.Pending() != nil || spool.Remove("x") != nil {
		t.Fatal("a nil spool has nothing and refuses nothing")
	}
}

/*
Events go up only to a Lore that said it reads them. Its client-frame schema
is a strict union, so an unknown frame type would be a protocol error there.
*/
func TestFlushEventsWaitsForTheFeatureAndKeepsWhatFailed(t *testing.T) {
	spool := NewEventSpool(t.TempDir(), 0)
	_, _ = spool.Append("backup.completed", "demo", "production", nil)
	_, _ = spool.Append("backup.failed", "demo", "production", nil)
	conn := &writeConn{}
	c := &Client{Events: spool, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	c.setConn(conn)

	c.flushEvents()
	if len(conn.written) != 0 || len(spool.Pending()) != 2 {
		t.Fatal("nothing is sent before the welcome advertises events")
	}

	conn.fail = true
	c.eventsOK.Store(true)
	c.flushEvents()
	if len(spool.Pending()) != 2 {
		t.Fatal("an event that could not be written stays spooled")
	}

	conn.fail = false
	c.flushEvents()
	if len(conn.written) != 2 || len(spool.Pending()) != 0 {
		t.Fatalf("sent in order and removed: wrote %d, %d left", len(conn.written), len(spool.Pending()))
	}
	if e := conn.written[0].(Event); e.Kind != "backup.completed" {
		t.Fatalf("oldest first: %+v", e)
	}
}

func TestHasFeature(t *testing.T) {
	if !hasFeature([]string{"stats", EventsFeature}, EventsFeature) || hasFeature(nil, EventsFeature) {
		t.Fatal("hasFeature")
	}
}
