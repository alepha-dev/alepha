package main

import (
	"context"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alepha-dev/bay/internal/deploy"
	"github.com/alepha-dev/bay/internal/state"
)

func target(endpoint, bucket, key string) *state.S3Target {
	return &state.S3Target{Endpoint: endpoint, Bucket: bucket, AccessKey: key, SecretKey: "s", Region: "auto"}
}

func doctorPolicy(t *testing.T) *policyS3 {
	t.Helper()
	return newPolicyS3(t, map[string][]string{
		"backup-key": {"backups/"},
		"global-key": {"bay-blobs/"},
		"demo-key":   {demoPrefix},
		"wide-key":   {"bay-blobs/", "backups/"},
	})
}

func findCheck(t *testing.T, checks []check, name string) check {
	t.Helper()
	for _, c := range checks {
		if c.Name == name {
			return c
		}
	}
	t.Fatalf("no %q check in %+v", name, checks)
	return check{}
}

func TestDoctorReportsAnUnreachableBackupBucket(t *testing.T) {
	down := httptest.NewServer(nil)
	down.Close()
	st := &state.State{S3: &state.S3Config{S3Target: *target(down.URL, "backups", "backup-key")}}
	c := findCheck(t, storageChecksFor(context.Background(), st, false), "s3 backups")
	if c.OK || !strings.Contains(c.Detail, "unreachable") {
		t.Fatalf("a bucket that is down must fail and say so: %+v", c)
	}
}

// Shared keys are every host from before per-app keys: warned, not failed.
func TestDoctorWarnsASharedBackupKey(t *testing.T) {
	p := doctorPolicy(t)
	st := &state.State{
		S3:      &state.S3Config{S3Target: *target(p.srv.URL, "backups", "backup-key")},
		Storage: target(p.srv.URL, "bay-blobs", "backup-key"),
	}
	checks := storageChecksFor(context.Background(), st, false)
	c := findCheck(t, checks, "s3 separate keys")
	if c.OK || !c.Warn {
		t.Fatalf("one key for both must be a warning: %+v", c)
	}
	if failed := printChecks(io.Discard, []check{c}); failed != 0 {
		t.Fatalf("a warning must not fail doctor, %d failed", failed)
	}
}

func TestDoctorWarnsAppsSharingTheHostWideKey(t *testing.T) {
	p := doctorPolicy(t)
	st := &state.State{
		S3:      &state.S3Config{S3Target: *target(p.srv.URL, "backups", "backup-key")},
		Storage: target(p.srv.URL, "bay-blobs", "global-key"),
		Apps: []state.App{
			{Name: "demo", Env: "production", StorageBackend: deploy.BackendS3},
			{Name: "other", Env: "production", StorageBackend: deploy.BackendS3},
		},
	}
	if c := findCheck(t, storageChecksFor(context.Background(), st, false), "s3 app isolation"); c.OK || !c.Warn {
		t.Fatalf("two apps on one key must be a warning: %+v", c)
	}

	st.InstanceStorage = map[string]*state.S3Target{"demo/production": target(p.srv.URL, "bay-blobs", "demo-key")}
	checks := storageChecksFor(context.Background(), st, true)
	if c := findCheck(t, checks, "s3 app isolation"); !c.OK {
		t.Fatalf("one app left on the host-wide key shares it with nobody: %+v", c)
	}
	if c := findCheck(t, checks, "s3 key demo/production"); !c.OK {
		t.Fatalf("a scoped key must pass: %+v", c)
	}
}

func TestDoctorFailsAnInstanceKeyThatIsNotIsolated(t *testing.T) {
	p := doctorPolicy(t)
	st := &state.State{
		S3:              &state.S3Config{S3Target: *target(p.srv.URL, "backups", "backup-key")},
		InstanceStorage: map[string]*state.S3Target{"demo/production": target(p.srv.URL, "bay-blobs", "wide-key")},
	}
	c := findCheck(t, storageChecksFor(context.Background(), st, true), "s3 key demo/production")
	if c.OK || c.Warn || !strings.Contains(c.Detail, "the backups") {
		t.Fatalf("a key reaching the backups must fail and name them: %+v", c)
	}
}

// Off fails for blobs, unknown never does: R2 does not implement the call.
func TestDoctorVersioningOnTheBlobBucket(t *testing.T) {
	p := doctorPolicy(t)
	st := &state.State{
		S3:      &state.S3Config{S3Target: *target(p.srv.URL, "backups", "backup-key")},
		Storage: target(p.srv.URL, "bay-blobs", "global-key"),
	}
	for status, ok := range map[string]bool{"Enabled": true, "Suspended": false} {
		p.versioning = map[string]string{"bay-blobs": status}
		if c := findCheck(t, storageChecksFor(context.Background(), st, false), "s3 apps"); c.OK != ok {
			t.Fatalf("versioning %s: %+v", status, c)
		}
	}
	p.versioning = nil
	if c := findCheck(t, storageChecksFor(context.Background(), st, false), "s3 apps"); !c.OK || !strings.Contains(c.Detail, "unknown") {
		t.Fatalf("an unanswered versioning call is unknown, not a failure: %+v", c)
	}
	p.versioning = map[string]string{"backups": "Suspended"}
	if c := findCheck(t, storageChecksFor(context.Background(), st, false), "s3 backups"); !c.OK {
		t.Fatalf("a backup bucket without versioning is reported, not failed: %+v", c)
	}
}

func TestDoctorReadsStateWithoutWritingIt(t *testing.T) {
	root := t.TempDir()
	if got := storageChecks(root, false); got != nil {
		t.Fatalf("a fresh host has nothing to check: %+v", got)
	}
	p := doctorPolicy(t)
	raw := `{"s3":{"endpoint":"` + p.srv.URL + `","bucket":"backups","accessKey":"backup-key","secretKey":"s","region":"auto"}}`
	path := filepath.Join(root, "state.json")
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	if c := findCheck(t, storageChecks(root, false), "s3 backups"); !c.OK {
		t.Fatalf("got %+v", c)
	}
	after, _ := os.ReadFile(path)
	if string(after) != raw {
		t.Fatal("doctor must not rewrite state.json under a running bay serve")
	}
}

// Proving isolation writes probe objects; plain `bay doctor` must not.
func TestDoctorWritesNothingWithoutProbeKeys(t *testing.T) {
	p := doctorPolicy(t)
	st := &state.State{
		S3:              &state.S3Config{S3Target: *target(p.srv.URL, "backups", "backup-key")},
		Storage:         target(p.srv.URL, "bay-blobs", "global-key"),
		InstanceStorage: map[string]*state.S3Target{"demo/production": target(p.srv.URL, "bay-blobs", "wide-key")},
	}
	checks := storageChecksFor(context.Background(), st, false)
	if n := p.writes; n != 0 {
		t.Fatalf("doctor without --probe-keys sent %d PUT/DELETE", n)
	}
	if c := findCheck(t, checks, "s3 key demo/production"); !c.OK || !strings.Contains(c.Detail, "--probe-keys") {
		t.Fatalf("an unprobed key must say how to probe it: %+v", c)
	}
	if _, found := findCheckOK(checks, "s3 apps key"); found {
		t.Fatal("the host-wide key must not be probed without --probe-keys")
	}
}

// Apps without a key of their own hold the host-wide one: tried against each
// app's backup prefix, since a refusal on apps/ says nothing below it.
func TestDoctorProbesTheHostWideKeyAgainstTheBackups(t *testing.T) {
	p := newPolicyS3(t, map[string][]string{
		"backup-key": {"bay-blobs/"},
		"global-key": {"bay-blobs/apps/demo-production/"},
	})
	st := &state.State{
		S3:      &state.S3Config{S3Target: *target(p.srv.URL, "bay-blobs", "backup-key")},
		Storage: target(p.srv.URL, "bay-blobs", "global-key"),
		Apps:    []state.App{{Name: "demo", Env: "production", StorageBackend: deploy.BackendS3}},
	}
	c := findCheck(t, storageChecksFor(context.Background(), st, true), "s3 apps key")
	if c.OK || !c.Warn || !strings.Contains(c.Detail, "backups of demo/production") {
		t.Fatalf("a host-wide key reaching an app's backups must be warned, naming them: %+v", c)
	}

	p.grants["global-key"] = []string{"bay-blobs/apps/demo-production/blobs/"}
	if c := findCheck(t, storageChecksFor(context.Background(), st, true), "s3 apps key"); !c.OK {
		t.Fatalf("a key scoped to the blobs is refused on the backups: %+v", c)
	}
}

func findCheckOK(checks []check, name string) (check, bool) {
	for _, c := range checks {
		if c.Name == name {
			return c, true
		}
	}
	return check{}, false
}

// Stored on purpose with --allow-wide-key: a known trade-off, warned.
func TestDoctorWarnsAWideKeyStoredOnPurpose(t *testing.T) {
	p := doctorPolicy(t)
	st := &state.State{
		S3:                  &state.S3Config{S3Target: *target(p.srv.URL, "backups", "backup-key")},
		InstanceStorage:     map[string]*state.S3Target{"demo/production": target(p.srv.URL, "bay-blobs", "wide-key")},
		WideInstanceStorage: map[string]bool{"demo/production": true},
	}
	c := findCheck(t, storageChecksFor(context.Background(), st, true), "s3 key demo/production")
	if c.OK || !c.Warn || !strings.Contains(c.Detail, "--allow-wide-key") {
		t.Fatalf("a key stored wide on purpose must warn, saying so: %+v", c)
	}
}

// state.json is root's: an operator in the control group running doctor gets
// a warning that the S3 half was not checked, not a failed host.
func TestDoctorWarnsWhenItCannotReadTheState(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root reads a 0000 file")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "state.json"), []byte("{}"), 0); err != nil {
		t.Fatal(err)
	}
	checks := storageChecks(root, false)
	if len(checks) != 1 || checks[0].OK || !checks[0].Warn || !strings.Contains(checks[0].Detail, "root only") {
		t.Fatalf("got %+v", checks)
	}
}
