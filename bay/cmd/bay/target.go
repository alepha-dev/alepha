package main

import (
	"context"
	"sync"
	"time"

	"github.com/alepha-dev/bay/internal/s3"
)

/*
targetHealth is whether the backup bucket answers, watched rather than
discovered.

Without it, a bucket that went down at 1am is found at 3am by the first
scheduled backup, reported as that app's failure, and found again by every
other app's: N failures for one cause, none of them saying "the bucket". With
it, the bucket has a status of its own, a probe every few minutes, one event
when it goes down and one when it comes back, and a backup failure can say
which of the two broke.

In memory: after a restart the status is "unknown" until the first probe, a
few seconds later. Persisting it would report a stale "down" on boot.
*/
type targetHealth struct {
	// probeFn reaches the bucket; nil means "the configured backup target".
	probeFn func(ctx context.Context) error
	now     func() time.Time

	mu          sync.Mutex
	status      string // unknown | ok | degraded | down | unconfigured
	since       time.Time
	lastProbeAt time.Time
	lastError   string
	failures    int
	bucket      string
}

// targetStatus is a copy of targetHealth for readers.
type targetStatus struct {
	Status      string `json:"status"`
	Since       string `json:"since,omitempty"`
	LastProbeAt string `json:"lastProbeAt,omitempty"`
	LastError   string `json:"lastError,omitempty"`
	Failures    int    `json:"failures,omitempty"`
	Bucket      string `json:"bucket,omitempty"`
}

const (
	// targetProbeEvery is how often the backup loop asks the bucket.
	targetProbeEvery = 5 * time.Minute
	// targetDownAfter failed probes in a row and the bucket is "down", not
	// merely "degraded": one timeout is a blip, three are an outage.
	targetDownAfter = 3
)

func newTargetHealth() *targetHealth {
	return &targetHealth{status: "unknown", now: time.Now}
}

func (t *targetHealth) snapshot() targetStatus {
	if t == nil {
		return targetStatus{Status: "unknown"}
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	out := targetStatus{Status: t.status, LastError: clip(t.lastError), Failures: t.failures, Bucket: t.bucket}
	if !t.since.IsZero() {
		out.Since = t.since.UTC().Format(time.RFC3339)
	}
	if !t.lastProbeAt.IsZero() {
		out.LastProbeAt = t.lastProbeAt.UTC().Format(time.RFC3339)
	}
	return out
}

// probe asks the bucket once, updates the status, emits on a transition, and
// reports whether the bucket answered. An unconfigured target is not down:
// it reports true, so a failure is not blamed on a bucket that isn't there.
func (t *targetHealth) probe(ctx context.Context, s *server) bool {
	if t == nil {
		return true
	}
	probe := t.probeFn
	bucket := ""
	if probe == nil {
		cfg := s.store.S3()
		if cfg == nil {
			t.set(s, "unconfigured", "", "")
			return true
		}
		bucket = cfg.Bucket
		client, err := s3.New(s3.Config{Endpoint: cfg.Endpoint, Bucket: cfg.Bucket,
			AccessKey: cfg.AccessKey, SecretKey: cfg.SecretKey, Region: cfg.Region})
		if err != nil {
			t.set(s, "down", bucket, err.Error())
			return false
		}
		probe = func(ctx context.Context) error {
			// A prefix nothing lives under: the answer is empty and cheap, and
			// it exercises exactly what a backup needs (reach, sign, list).
			_, err := client.List(ctx, "bay-probe/")
			return err
		}
	}
	ctx, cancel := context.WithTimeout(ctx, storageProbeTimeout)
	defer cancel()
	if err := probe(ctx); err != nil {
		t.set(s, "", bucket, err.Error())
		return false
	}
	t.set(s, "ok", bucket, "")
	return true
}

// set records a probe's outcome. status "" means "a failure": degraded, then
// down after targetDownAfter in a row.
func (t *targetHealth) set(s *server, status, bucket, failure string) {
	now := t.now()
	t.mu.Lock()
	prev := t.status
	t.lastProbeAt = now
	if bucket != "" {
		t.bucket = bucket
	}
	switch status {
	case "":
		t.failures++
		t.lastError = failure
		status = "degraded"
		if t.failures >= targetDownAfter {
			status = "down"
		}
	case "down":
		t.failures++
		t.lastError = failure
	default:
		t.failures = 0
		t.lastError = ""
	}
	if status != prev {
		t.since = now
	}
	t.status = status
	snap := targetStatus{Status: status, Bucket: t.bucket, LastError: clip(t.lastError), Failures: t.failures}
	t.mu.Unlock()

	if status == prev || s == nil {
		return
	}
	switch {
	case status == "down":
		s.log.Error("backup target is down", "bucket", snap.Bucket, "failures", snap.Failures, "err", snap.LastError)
		s.emit("target.down", nil, map[string]any{"bucket": snap.Bucket, "error": snap.LastError, "failures": snap.Failures})
	case status == "ok" && (prev == "down" || prev == "degraded"):
		s.log.Info("backup target is reachable again", "bucket", snap.Bucket)
		s.emit("target.up", nil, map[string]any{"bucket": snap.Bucket, "was": prev})
	}
}
