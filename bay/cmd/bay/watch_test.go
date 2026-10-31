package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/health"
	"github.com/alepha-dev/bay/internal/state"
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

// downWhileStopped is a /health that answers only while the app runs, the way
// a closed port does.
type downWhileStopped struct{ runner *fakeRunner }

func (d downWhileStopped) RoundTrip(req *http.Request) (*http.Response, error) {
	if !d.runner.Running("demo/production") {
		return nil, errors.New("connection refused")
	}
	return readyTransport{}.RoundTrip(req)
}

func TestAStorageMigrationInsideTheWindowIsNotRolledBack(t *testing.T) {
	// The migration stops the app for as long as its files take to copy. To the
	// watch that is a dead release, and the rollback would start the previous
	// one while the copy is still walking its directory.
	f := localAppWithUploads(t)
	s := f.server
	s.probe = &health.Probe{Client: &http.Client{Transport: downWhileStopped{f.runner}}}
	s.watchWindow, s.watchEvery = time.Minute, time.Millisecond
	key := "demo/production"
	out, failure := s.deployArtifact(context.Background(), deployArtifactOptions{
		Artifact: bucketDeployableArtifact(t), Name: "demo", Env: "production",
	})
	if failure != nil {
		t.Fatalf("redeploy: %v", failure)
	}

	var once sync.Once
	copying, finish := make(chan struct{}), make(chan struct{})
	blobs := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		once.Do(func() { close(copying) })
		<-finish
	}))
	defer blobs.Close()
	if err := s.store.SetStorage(&state.S3Target{
		Endpoint: blobs.URL, Bucket: "bay-blobs", AccessKey: "a", SecretKey: "b", Region: "auto",
	}); err != nil {
		t.Fatal(err)
	}

	for !s.watching(key) {
		time.Sleep(time.Millisecond)
	}
	migrated := make(chan *httptest.ResponseRecorder)
	go func() { migrated <- migrateStorage(t, f) }()
	<-copying
	waitForWatch(t, s, key)
	close(finish)

	if rec := <-migrated; rec.Code != http.StatusOK {
		t.Fatalf("migrate: %d %s", rec.Code, rec.Body)
	}
	if got := f.app(t).Release; got != out.Result.Release {
		t.Fatalf("rolled back to %s in the middle of the migration", got)
	}
}

func TestARestoreEndsTheWatch(t *testing.T) {
	// Same stop, same reason, and worse timing: the rollback would start the
	// previous release on a database that is being swapped.
	f := newBackupFixture(t)
	newRecoveryBucket(t, f)
	watch := f.server.beginWatch("demo/production")

	req := httptest.NewRequest(http.MethodPost, "/apps/demo/production/restore?confirm=yes", nil)
	req.SetPathValue("name", "demo")
	req.SetPathValue("env", "production")
	rec := httptest.NewRecorder()
	f.server.handleRestore(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body)
	}
	if watch.Err() == nil {
		t.Fatal("the watch must end before the app is stopped for the restore")
	}
}
