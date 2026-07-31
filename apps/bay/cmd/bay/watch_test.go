package main

import (
	"sync"
	"testing"
)

/*
The concurrency bug these cover, observed on a real host.

Two deploys of the same app six seconds apart each started a rollback watch.
Both watches probed the same port, both saw the same wedged process, and both
reached an unhealthy verdict. They then rolled back in sequence: the first to
the release it had replaced — correct — and the second, which had been watching
a release that no longer existed, to something older still. The app ended up on
a release older than the one the operator had just replaced, which is worse than
having left the bad one running.

Two things were missing: a deploy must supersede the previous deploy's watch,
and a watch must never roll back a release that is no longer installed.
*/

func TestANewDeploySupersedesThePreviousWatch(t *testing.T) {
	s := &server{}

	first := s.beginWatch("demo/production")
	if first.Err() != nil {
		t.Fatal("the first watch should be live")
	}

	second := s.beginWatch("demo/production")

	if first.Err() == nil {
		t.Fatal("the earlier watch must be cancelled — it is probing a release that is gone")
	}
	if second.Err() != nil {
		t.Fatal("the newer watch owns the app now")
	}
}

func TestWatchesOnDifferentAppsDoNotCancelEachOther(t *testing.T) {
	s := &server{}

	a := s.beginWatch("alpha/production")
	b := s.beginWatch("beta/production")

	if a.Err() != nil {
		t.Fatal("deploying beta must not stop watching alpha")
	}
	if b.Err() != nil {
		t.Fatal("beta's own watch should be live")
	}
}

func TestEndWatchDoesNotCancelAWatchThatSupersededIt(t *testing.T) {
	// Ordering that actually happens: the superseded goroutine runs its
	// deferred cleanup after the new watch has already registered. Dropping the
	// map entry is fine; cancelling would kill the live watch.
	s := &server{}

	first := s.beginWatch("demo/production")
	second := s.beginWatch("demo/production")
	_ = first

	s.endWatch("demo/production")

	if second.Err() != nil {
		t.Fatal("the live watch must survive the superseded one's cleanup")
	}
}

func TestConcurrentDeploysLeaveExactlyOneLiveWatch(t *testing.T) {
	s := &server{}

	var wg sync.WaitGroup
	contexts := make([]interface{ Err() error }, 20)
	for i := range contexts {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			contexts[i] = s.beginWatch("demo/production")
		}(i)
	}
	wg.Wait()

	live := 0
	for _, ctx := range contexts {
		if ctx.Err() == nil {
			live++
		}
	}
	if live != 1 {
		t.Fatalf("exactly one watch may reach a verdict, %d are live", live)
	}
}
