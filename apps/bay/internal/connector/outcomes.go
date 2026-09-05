package connector

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// OutcomesFileName is where executed command ids and what became of them
// live, under Bay's root. Read at boot so a restart of `bay serve` forgets
// nothing that already ran.
const OutcomesFileName = "connector-outcomes.json"

// outcomesCap bounds the file. Lore keeps its own history and redelivers
// only what is still open, so a few hundred terminal ids cover any
// reconciliation; older ones are dropped oldest first.
const outcomesCap = 200

// Outcome is what became of one command id.
type Outcome struct {
	ID     string    `json:"id"`
	Status string    `json:"status"`
	Step   string    `json:"step,omitempty"`
	Reason string    `json:"reason,omitempty"`
	At     time.Time `json:"at"`
}

/*
Outcomes makes actions idempotent by id.

Lore's reconciliation on reconnect redelivers any command whose ack was lost,
even one that actually ran. Running a restart twice is acceptable; running it
on every reconnect is not, and a deploy run twice is two release swaps. So the
outcome of every executed id is kept here, in memory and on disk under the Bay
root: a redelivered id that is already terminal is re-acked with what was
stored, never re-run, and one still running gets nothing until it finishes.

Only terminal outcomes reach the disk. A `running` id is in memory alone, so a
`bay serve` that dies mid-action forgets it and the next redelivery runs it
again, which is the one case where twice is the right answer: the action did
not finish.
*/
type Outcomes struct {
	mu      sync.Mutex
	path    string
	running map[string]bool
	done    map[string]Outcome
	// order holds terminal ids oldest first, for the cap.
	order []string
}

// OpenOutcomes loads the file, or starts empty when there is none. A file
// that cannot be parsed is reported AND started over: refusing to run the
// connector over a corrupt history would take the machine off the air, and
// the cost of forgetting is one redelivered action running again.
func OpenOutcomes(root string) (*Outcomes, error) {
	o := &Outcomes{
		path:    filepath.Join(root, OutcomesFileName),
		running: map[string]bool{},
		done:    map[string]Outcome{},
	}
	raw, err := os.ReadFile(o.path)
	if os.IsNotExist(err) {
		return o, nil
	}
	if err != nil {
		return o, fmt.Errorf("read %s: %w", o.path, err)
	}
	var list []Outcome
	if err := json.Unmarshal(raw, &list); err != nil {
		return o, fmt.Errorf("parse %s: %w", o.path, err)
	}
	for _, out := range list {
		o.done[out.ID] = out
		o.order = append(o.order, out.ID)
	}
	return o, nil
}

// Get returns the terminal outcome of an id, if it has one.
func (o *Outcomes) Get(id string) (Outcome, bool) {
	o.mu.Lock()
	defer o.mu.Unlock()
	out, ok := o.done[id]
	return out, ok
}

// Begin claims an id for execution. False means it is already running or
// already terminal, and the caller must not run it.
func (o *Outcomes) Begin(id string) bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.running[id] {
		return false
	}
	if _, ok := o.done[id]; ok {
		return false
	}
	o.running[id] = true
	return true
}

// Finish records the terminal outcome of an id and persists it.
func (o *Outcomes) Finish(id, status, step, reason string, at time.Time) (Outcome, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	delete(o.running, id)
	out := Outcome{ID: id, Status: status, Step: step, Reason: reason, At: at.UTC()}
	if _, known := o.done[id]; !known {
		o.order = append(o.order, id)
	}
	o.done[id] = out
	for len(o.order) > outcomesCap {
		oldest := o.order[0]
		o.order = o.order[1:]
		delete(o.done, oldest)
	}
	return out, o.flush()
}

// Running reports whether an id is being executed right now.
func (o *Outcomes) Running(id string) bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.running[id]
}

func (o *Outcomes) flush() error {
	list := make([]Outcome, 0, len(o.order))
	for _, id := range o.order {
		list = append(list, o.done[id])
	}
	raw, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(o.path), 0o755); err != nil {
		return err
	}
	tmp := o.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, o.path)
}
