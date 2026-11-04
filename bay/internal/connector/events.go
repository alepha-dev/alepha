package connector

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

/*
Events are what happened on this machine that Lore should hear about even if
it was not listening at the time: a backup that failed at 3am, a bucket that
went down, a restore somebody ran from the CLI.

An inventory says what IS; an event says what HAPPENED. Inventories are
recomputed and pushed whole, so a lost one costs nothing. An event lost is a
3am failure nobody reads about, so events are spooled on disk until Lore has
taken them and dropped only when the spool is full (oldest first, so the
latest picture survives a long outage).

Sent only to a Lore that said it understands them (`features: ["events"]` on
its welcome). Lore's protocol-1 parser refuses frames it does not know, so an
older Lore would see an event as a protocol error; until it advertises the
feature, events wait in the spool.
*/

// EventsFeature is the welcome feature that turns event frames on.
const EventsFeature = "events"

// EventsFileName is the spool, under Bay's root.
const EventsFileName = "connector-events.json"

// DefaultEventSpoolMax bounds the spool. Past it the oldest are dropped.
const DefaultEventSpoolMax = 500

// Event is one occurrence, as sent: `{"type":"event", ...}`.
type Event struct {
	Type string `json:"type"`
	// ID is unique per event, so a Lore that receives one twice (sent, then
	// the connection dropped before it was removed here) keeps it once.
	ID   string         `json:"id"`
	Kind string         `json:"kind"`
	At   string         `json:"at"`
	App  string         `json:"app,omitempty"`
	Env  string         `json:"env,omitempty"`
	Data map[string]any `json:"data,omitempty"`
}

// EventSpool is the on-disk queue of events not yet taken by Lore. Safe for
// concurrent use; nil is a valid spool that keeps nothing.
type EventSpool struct {
	path string
	max  int
	now  func() time.Time

	mu      sync.Mutex
	loaded  bool
	pending []Event
	kick    chan struct{}
}

// NewEventSpool keeps events under root. max <= 0 is DefaultEventSpoolMax.
func NewEventSpool(root string, max int) *EventSpool {
	if max <= 0 {
		max = DefaultEventSpoolMax
	}
	return &EventSpool{path: filepath.Join(root, EventsFileName), max: max, now: time.Now, kick: make(chan struct{}, 1)}
}

func newEventID() string {
	var b [12]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// Append records an event and wakes the sender. Never fails the caller's
// work: an event that could not be spooled is logged by the caller, at most.
func (s *EventSpool) Append(kind, app, env string, data map[string]any) (Event, error) {
	if s == nil {
		return Event{}, nil
	}
	e := Event{Type: "event", ID: newEventID(), Kind: kind, App: app, Env: env, Data: data,
		At: s.now().UTC().Format(time.RFC3339)}
	s.mu.Lock()
	s.load()
	s.pending = append(s.pending, e)
	if over := len(s.pending) - s.max; over > 0 {
		s.pending = append([]Event(nil), s.pending[over:]...)
	}
	err := s.save()
	s.mu.Unlock()
	select {
	case s.kick <- struct{}{}:
	default:
	}
	return e, err
}

// Pending is a copy of what has not been taken yet, oldest first.
func (s *EventSpool) Pending() []Event {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.load()
	return append([]Event(nil), s.pending...)
}

// Remove drops events Lore has taken.
func (s *EventSpool) Remove(ids ...string) error {
	if s == nil || len(ids) == 0 {
		return nil
	}
	gone := make(map[string]bool, len(ids))
	for _, id := range ids {
		gone[id] = true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.load()
	kept := s.pending[:0]
	for _, e := range s.pending {
		if !gone[e.ID] {
			kept = append(kept, e)
		}
	}
	s.pending = kept
	return s.save()
}

// Kicks fires after each Append.
func (s *EventSpool) Kicks() <-chan struct{} {
	if s == nil {
		return nil
	}
	return s.kick
}

// load reads the spool once. A spool that cannot be read is started over:
// losing old events beats refusing to record new ones.
func (s *EventSpool) load() {
	if s.loaded {
		return
	}
	s.loaded = true
	raw, err := os.ReadFile(s.path)
	if err != nil {
		return
	}
	var events []Event
	if json.Unmarshal(raw, &events) == nil {
		s.pending = events
	}
}

func (s *EventSpool) save() error {
	if len(s.pending) == 0 {
		if err := os.Remove(s.path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	raw, err := json.Marshal(s.pending)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, Mode); err != nil {
		return err
	}
	if err := os.Chmod(tmp, Mode); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// flushEvents sends what is spooled, oldest first, removing each once
// written. Stops at the first failure: the rest wait for the next connection.
func (c *Client) flushEvents() {
	if c.Events == nil || !c.eventsOK.Load() {
		return
	}
	c.flushMu.Lock()
	defer c.flushMu.Unlock()
	for _, e := range c.Events.Pending() {
		if err := c.Send(e); err != nil {
			return
		}
		if err := c.Events.Remove(e.ID); err != nil {
			c.Log.Warn("could not remove a sent event from the spool", "err", err)
			return
		}
	}
}

// eventsLoop sends on each append, for the life of one connection.
func (c *Client) eventsLoop(ctx context.Context) {
	if c.Events == nil {
		return
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.Events.Kicks():
			c.flushEvents()
		}
	}
}

func hasFeature(features []string, name string) bool {
	for _, f := range features {
		if f == name {
			return true
		}
	}
	return false
}
