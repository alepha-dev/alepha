package connector

import (
	"fmt"
	"os"
	"testing"
	"time"
)

func TestOutcomesClaimOnceAndReackFromStore(t *testing.T) {
	o, err := OpenOutcomes(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if !o.Begin("c1") {
		t.Fatal("a fresh id must be claimable")
	}
	if o.Begin("c1") {
		t.Fatal("an id already running must not be claimed again")
	}
	if !o.Running("c1") {
		t.Fatal("Running must report the claim")
	}
	if _, ok := o.Get("c1"); ok {
		t.Fatal("a running id has no terminal outcome yet")
	}

	at := time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)
	out, err := o.Finish("c1", "failed", "start", "would not boot", at)
	if err != nil {
		t.Fatal(err)
	}
	if out.Status != "failed" || out.Step != "start" || out.Reason != "would not boot" {
		t.Fatalf("Finish returned something else: %+v", out)
	}
	if o.Begin("c1") {
		t.Fatal("a terminal id must never run again")
	}
	if got, ok := o.Get("c1"); !ok || got != out {
		t.Fatalf("Get after Finish = %+v, %v", got, ok)
	}
	if o.Running("c1") {
		t.Fatal("a finished id is not running")
	}
}

func TestOutcomesSurviveARestartOfServe(t *testing.T) {
	root := t.TempDir()
	first, _ := OpenOutcomes(root)
	first.Begin("c1")
	if _, err := first.Finish("c1", "done", "", "", time.Now()); err != nil {
		t.Fatal(err)
	}

	// A new process, same root: the id is still terminal.
	second, err := OpenOutcomes(root)
	if err != nil {
		t.Fatal(err)
	}
	if out, ok := second.Get("c1"); !ok || out.Status != "done" {
		t.Fatalf("outcome lost across a reload: %+v, %v", out, ok)
	}
	if second.Begin("c1") {
		t.Fatal("a terminal id must stay terminal after a reload")
	}
	// A running id is memory only: a serve that died mid-action runs the
	// redelivered id again, which is the one case where twice is right.
	first.Begin("c2")
	third, _ := OpenOutcomes(root)
	if !third.Begin("c2") {
		t.Fatal("an id that never finished must be runnable after a reload")
	}
}

func TestOutcomesAreCappedOldestFirst(t *testing.T) {
	root := t.TempDir()
	o, _ := OpenOutcomes(root)
	for i := 0; i < outcomesCap+5; i++ {
		id := fmt.Sprintf("c%03d", i)
		o.Begin(id)
		if _, err := o.Finish(id, "done", "", "", time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	if _, ok := o.Get("c000"); ok {
		t.Fatal("the oldest outcome must be dropped past the cap")
	}
	if _, ok := o.Get(fmt.Sprintf("c%03d", outcomesCap+4)); !ok {
		t.Fatal("the newest outcome must be kept")
	}
	reloaded, _ := OpenOutcomes(root)
	if _, ok := reloaded.Get("c005"); !ok {
		t.Fatal("the cap must be what is written, not only what is held")
	}
}

func TestOutcomesStartOverOnACorruptFile(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(root+"/"+OutcomesFileName, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	o, err := OpenOutcomes(root)
	if err == nil {
		t.Fatal("a corrupt history must be reported")
	}
	if o == nil || !o.Begin("c1") {
		t.Fatal("and the connector must still run, empty")
	}
}
