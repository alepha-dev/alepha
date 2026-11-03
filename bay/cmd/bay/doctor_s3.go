package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/alepha-dev/bay/internal/backup"
	"github.com/alepha-dev/bay/internal/deploy"
	"github.com/alepha-dev/bay/internal/s3"
	"github.com/alepha-dev/bay/internal/state"
)

/*
storageChecks is the S3 half of `bay doctor`: can each bucket Bay holds a key
for be reached, is anything recoverable after a bad delete, and does each app
key reach only what it should.

Read straight from state.json rather than through state.Open: doctor runs
beside a live `bay serve`, and opening the store may write it.

Every check talks to the bucket, so a bucket that is down shows here, before a
deploy finds out by starting an app on an empty database.

Read-only by default: proving a key isolated means trying to write where it
must not, so the key probes run only with `--probe-keys`. Keys shared between
apps are warnings - a risk on a host that works, and the state of every host
that predates per-app keys. The one failure is a per-app key that was stored
as isolated and no longer is.
*/
func storageChecks(root string, probeKeys bool) []check {
	raw, err := os.ReadFile(filepath.Join(root, "state.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil // nothing configured yet: a fresh host, before `bay serve`.
	}
	if err != nil {
		return []check{{Name: "s3", Detail: "cannot read state.json: " + err.Error()}}
	}
	var st state.State
	if err := json.Unmarshal(raw, &st); err != nil {
		return []check{{Name: "s3", Detail: "state.json is not valid JSON: " + err.Error()}}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	return storageChecksFor(ctx, &st, probeKeys)
}

func storageChecksFor(ctx context.Context, st *state.State, probeKeys bool) []check {
	var checks []check
	if st.S3 == nil {
		// Not a failure on a host that has not got there yet, but said, since
		// it means every database lives on this one disk.
		checks = append(checks, check{Name: "s3 backups", OK: true,
			Detail: "not configured: databases are not copied off this host (bay config s3:backups)"})
	} else {
		checks = append(checks, bucketCheck(ctx, "s3 backups", st.S3.S3Target, false))
	}
	if st.Storage != nil {
		checks = append(checks, bucketCheck(ctx, "s3 apps", *st.Storage, true))
	}

	instances := map[string]state.S3Target{}
	for k, t := range st.InstanceStorage {
		if t != nil {
			instances[k] = *t
		}
	}

	// The backup key in an app's hands is every backup deletable by any app.
	if st.S3 != nil {
		shared := check{Name: "s3 separate keys", OK: true, Detail: "the backup key is held by no app"}
		if state.SameCredential(&st.S3.S3Target, st.Storage) {
			shared = check{Name: "s3 separate keys", Warn: true,
				Detail: "the backup key is also the s3:apps key: any hosted app can delete every backup. Mint two keys (bay config s3:backups / s3:apps)"}
		}
		for k, t := range instances {
			if state.SameCredential(&st.S3.S3Target, &t) {
				shared = check{Name: "s3 separate keys", Warn: true,
					Detail: "the backup key is also " + k + "'s upload key: that app can delete every backup"}
			}
		}
		checks = append(checks, shared)
	}

	// Apps on the host-wide key can read and delete each other's blobs.
	var onWide []string
	for _, a := range st.Apps {
		if a.StorageBackend == deploy.BackendS3 && st.InstanceStorage[a.Key()] == nil {
			onWide = append(onWide, a.Key())
		}
	}
	sort.Strings(onWide)
	if len(onWide) > 1 {
		checks = append(checks, check{Name: "s3 app isolation", Warn: true, Detail: strings.Join(onWide, ", ") +
			" share the host-wide s3:apps key: each can read and delete the others' uploads. Give each its own (bay config s3:apps <name/env>)"})
	} else {
		checks = append(checks, check{Name: "s3 app isolation", OK: true,
			Detail: fmt.Sprintf("%d app(s) on their own key, %d on the host-wide one", len(instances), len(onWide))})
	}

	if probeKeys && st.Storage != nil && st.S3 != nil && !state.SameCredential(&st.S3.S3Target, st.Storage) {
		checks = append(checks, hostWideKeyCheck(ctx, st))
	}

	holders := storageHolders{backups: st.S3, storage: st.Storage, instances: instances, apps: st.Apps}
	keys := make([]string, 0, len(instances))
	for k := range instances {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if !probeKeys {
			checks = append(checks, check{Name: "s3 key " + k, OK: true,
				Detail: "own key stored; not re-proved (bay doctor --probe-keys writes a probe object to verify it)"})
			continue
		}
		checks = append(checks, instanceKeyCheck(ctx, holders, k, instances[k], st.WideInstanceStorage[k]))
	}
	return checks
}

/*
hostWideKeyCheck tries the host-wide s3:apps key, which every app without its
own key holds, against the backups: the bucket's apps/ and each app's db/
prefix, tried one by one since a refusal on apps/ says nothing below it.

A warning, not a failure: the key was configured knowingly, and the fix (a
narrower key, or a bucket of its own for backups) is the operator's.
*/
func hostWideKeyCheck(ctx context.Context, st *state.State) check {
	c := check{Name: "s3 apps key"}
	b := st.S3.S3Target
	if strings.TrimRight(b.Endpoint, "/") != strings.TrimRight(st.Storage.Endpoint, "/") {
		c.OK, c.Detail = true, "backups are on another S3 service: the apps key cannot reach them"
		return c
	}
	locs := []foreignLocation{{what: "the backups", target: b, prefix: "apps/"}}
	for _, a := range st.Apps {
		locs = append(locs, foreignLocation{what: "backups of " + a.Key(), target: b, prefix: backup.DBPrefix(a.Name, a.Env)})
	}
	probe, cancel := context.WithTimeout(ctx, isolationProbeTimeout)
	defer cancel()
	results, isolated := probeLocations(probe, *st.Storage, locs)
	if isolated {
		c.OK = true
		c.Detail = fmt.Sprintf("refused on the backups (%d location(s))", len(results))
		return c
	}
	var bad []string
	for _, r := range results {
		if r.Result != "denied" {
			bad = append(bad, r.Result+": "+r.What)
		}
	}
	c.Warn = true
	c.Detail = "the key every app without its own holds is not refused on the backups (" + strings.Join(bad, "; ") +
		"): scope it to the blob prefixes, or move backups to a bucket it cannot reach"
	return c
}

/*
bucketCheck reaches a bucket with its own key and reads its versioning.

Versioning only FAILS for a blob bucket: there it is the one undo there is,
since no Bay backup covers blobs. A backup bucket already keeps `keep N`
copies, so it is reported, not failed. A provider that does not implement the
call (R2) is "unknown", never "off".
*/
func bucketCheck(ctx context.Context, name string, t state.S3Target, needsVersioning bool) check {
	c := check{Name: name}
	client, err := s3.New(s3.Config{Endpoint: t.Endpoint, Bucket: t.Bucket,
		AccessKey: t.AccessKey, SecretKey: t.SecretKey, Region: t.Region})
	if err != nil {
		c.Detail = err.Error()
		return c
	}
	probe, cancel := context.WithTimeout(ctx, storageProbeTimeout)
	defer cancel()
	if _, err := client.ListPage(probe, "apps/", 1); err != nil {
		if s3.IsDenied(err) {
			c.Detail = t.Bucket + ": the key is refused (" + err.Error() + ")"
		} else {
			c.Detail = t.Bucket + ": unreachable, a deploy now starts apps on an empty database (" + err.Error() + ")"
		}
		return c
	}
	status, verr := client.Versioning(probe)
	switch {
	case verr != nil:
		c.OK = true
		c.Detail = t.Bucket + ": reachable; versioning unknown (the provider did not say)"
	case status == "Enabled":
		c.OK = true
		c.Detail = t.Bucket + ": reachable, versioning on"
	case needsVersioning:
		c.Detail = t.Bucket + ": reachable, but versioning is OFF: a deleted upload is gone everywhere. Turn it on in the provider's console"
	default:
		c.OK = true
		c.Detail = t.Bucket + ": reachable; versioning off (backups keep their own copies)"
	}
	return c
}

/*
instanceKeyCheck re-proves an app's own key. A key that no longer works, or
was proved isolated and no longer is, fails. One stored with --allow-wide-key
was known not to be: still not isolated is a warning, as when it was stored.
*/
func instanceKeyCheck(ctx context.Context, holders storageHolders, key string, own state.S3Target, wide bool) check {
	c := check{Name: "s3 key " + key}
	probe, cancel := context.WithTimeout(ctx, isolationProbeTimeout)
	defer cancel()
	report := probeIsolation(probe, holders, key, own)
	if !report.Works {
		c.Detail = "the app's own key no longer works: " + report.WorkError
		return c
	}
	var bad []string
	for _, ch := range report.Checks {
		if ch.Result != "denied" {
			bad = append(bad, ch.Result+": "+ch.What)
		}
	}
	if len(bad) > 0 {
		c.Detail = "not isolated (" + strings.Join(bad, "; ") + ")"
		if wide {
			c.Warn = true
			c.Detail += "; stored with --allow-wide-key"
		}
		return c
	}
	c.OK = true
	c.Detail = fmt.Sprintf("isolated: works on its prefix, refused on %d other location(s)", len(report.Checks))
	return c
}
