package main

import (
	"context"
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
	c := findCheck(t, storageChecksFor(context.Background(), st), "s3 backups")
	if c.OK || !strings.Contains(c.Detail, "unreachable") {
		t.Fatalf("a bucket that is down must fail and say so: %+v", c)
	}
}

func TestDoctorFailsASharedBackupKey(t *testing.T) {
	p := doctorPolicy(t)
	st := &state.State{
		S3:      &state.S3Config{S3Target: *target(p.srv.URL, "backups", "backup-key")},
		Storage: target(p.srv.URL, "bay-blobs", "backup-key"),
	}
	if c := findCheck(t, storageChecksFor(context.Background(), st), "s3 separate keys"); c.OK {
		t.Fatalf("one key for both must fail: %+v", c)
	}
}

func TestDoctorFailsAppsSharingTheHostWideKey(t *testing.T) {
	p := doctorPolicy(t)
	st := &state.State{
		S3:      &state.S3Config{S3Target: *target(p.srv.URL, "backups", "backup-key")},
		Storage: target(p.srv.URL, "bay-blobs", "global-key"),
		Apps: []state.App{
			{Name: "demo", Env: "production", StorageBackend: deploy.BackendS3},
			{Name: "other", Env: "production", StorageBackend: deploy.BackendS3},
		},
	}
	if c := findCheck(t, storageChecksFor(context.Background(), st), "s3 app isolation"); c.OK {
		t.Fatalf("two apps on one key must fail: %+v", c)
	}

	st.InstanceStorage = map[string]*state.S3Target{"demo/production": target(p.srv.URL, "bay-blobs", "demo-key")}
	checks := storageChecksFor(context.Background(), st)
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
	c := findCheck(t, storageChecksFor(context.Background(), st), "s3 key demo/production")
	if c.OK || !strings.Contains(c.Detail, "the backups") {
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
		if c := findCheck(t, storageChecksFor(context.Background(), st), "s3 apps"); c.OK != ok {
			t.Fatalf("versioning %s: %+v", status, c)
		}
	}
	p.versioning = nil
	if c := findCheck(t, storageChecksFor(context.Background(), st), "s3 apps"); !c.OK || !strings.Contains(c.Detail, "unknown") {
		t.Fatalf("an unanswered versioning call is unknown, not a failure: %+v", c)
	}
	p.versioning = map[string]string{"backups": "Suspended"}
	if c := findCheck(t, storageChecksFor(context.Background(), st), "s3 backups"); !c.OK {
		t.Fatalf("a backup bucket without versioning is reported, not failed: %+v", c)
	}
}

func TestDoctorReadsStateWithoutWritingIt(t *testing.T) {
	root := t.TempDir()
	if got := storageChecks(root); got != nil {
		t.Fatalf("a fresh host has nothing to check: %+v", got)
	}
	p := doctorPolicy(t)
	raw := `{"s3":{"endpoint":"` + p.srv.URL + `","bucket":"backups","accessKey":"backup-key","secretKey":"s","region":"auto"}}`
	path := filepath.Join(root, "state.json")
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	if c := findCheck(t, storageChecks(root), "s3 backups"); !c.OK {
		t.Fatalf("got %+v", c)
	}
	after, _ := os.ReadFile(path)
	if string(after) != raw {
		t.Fatal("doctor must not rewrite state.json under a running bay serve")
	}
}
