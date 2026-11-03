package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/alepha-dev/bay/internal/backup"
	"github.com/alepha-dev/bay/internal/deploy"
	"github.com/alepha-dev/bay/internal/naming"
	"github.com/alepha-dev/bay/internal/runner"
	"github.com/alepha-dev/bay/internal/s3"
	"github.com/alepha-dev/bay/internal/state"
)

/*
One upload key per app instance, and the proof that it is one.

The host-wide `s3:apps` credential is written into every app's `.env`, so any
app can read and delete every other app's uploads: the `apps/<inst>/blobs`
prefix is a convention, not a permission. `bay config s3:apps <name/env>`
gives an instance a key of its own, and refuses it unless S3 itself says the
key cannot reach the backups or another app's blobs.

The proof is a NEGATIVE test, made with the new key against every place it
must not reach, and for each place every kind of access: list, get, put and
delete. A scope can grant one and not the others (a write-only key still
overwrites a backup), so a place counts as denied only when all four are
refused with 401/403. Any one that succeeds is a leak; anything else (timeout,
5xx) proves nothing and is reported as unverified, never as safe.

A refusal on a prefix says nothing about the prefixes under it: a key scoped
to `apps/<inst>/` is refused on `apps/` and still reaches `apps/<inst>/db/`,
where its own backups live. So the app's own backup prefix is a place of its
own, tried directly.
*/

// isolationCheck is one place the key was tried against.
type isolationCheck struct {
	What   string `json:"what"`
	Bucket string `json:"bucket"`
	Prefix string `json:"prefix"`
	// Result is "denied" (good), "reachable" (a leak) or "unverified".
	Result string `json:"result"`
	// Reached names the operations that went through, for a leak.
	Reached []string `json:"reached,omitempty"`
	Error   string   `json:"error,omitempty"`
}

type isolationReport struct {
	// Works is the positive half: the key can write, list and delete under
	// its own prefix. A key that cannot is refused whatever else is true.
	Works     bool             `json:"works"`
	WorkError string           `json:"workError,omitempty"`
	Checks    []isolationCheck `json:"checks"`
	// Isolated is true only when every check came back denied.
	Isolated bool `json:"isolated"`
}

// storageHolders is every credential-holding target on the host: what the
// running server reads from its store, and `bay doctor` from state.json.
type storageHolders struct {
	backups   *state.S3Config
	storage   *state.S3Target
	instances map[string]state.S3Target
}

func (s *server) storageHolders() storageHolders {
	return storageHolders{backups: s.store.S3(), storage: s.store.Storage(), instances: s.store.AllInstanceStorage()}
}

// foreignLocation is a bucket+prefix an instance's key must not reach.
type foreignLocation struct {
	what   string
	target state.S3Target
	prefix string
}

/*
foreignLocations lists, for instance `key`, every place on the same endpoint
that holds data that is not its own.

Same endpoint only: a key is minted by one S3 service and means nothing to
another, so trying it elsewhere would only produce noise reported as safety.
*/
func foreignLocations(hosts storageHolders, key string, own state.S3Target) []foreignLocation {
	sameEndpoint := func(t state.S3Target) bool {
		return strings.TrimRight(t.Endpoint, "/") == strings.TrimRight(own.Endpoint, "/")
	}
	var out []foreignLocation
	seen := map[string]bool{}
	add := func(what string, t state.S3Target, prefix string) {
		id := t.Bucket + "\x00" + prefix
		if !sameEndpoint(t) || seen[id] {
			return
		}
		seen[id] = true
		out = append(out, foreignLocation{what: what, target: t, prefix: prefix})
	}
	if b := hosts.backups; b != nil {
		add("the backups", b.S3Target, "apps/")
		name, env, _ := strings.Cut(key, "/")
		add("its own backups", b.S3Target, backup.DBPrefix(name, env))
	}
	if st := hosts.storage; st != nil {
		add("every app's uploads (host-wide s3:apps bucket)", *st, "apps/")
	}
	for other, t := range hosts.instances {
		if other == key {
			continue
		}
		name, env, _ := strings.Cut(other, "/")
		add("uploads of "+other, t, deploy.BlobPrefix(name, env)+"/")
	}
	// Its own bucket, above its own prefix - only when that bucket is shared.
	// A key scoped to a shared bucket rather than to its prefix reads whatever
	// another app puts there later. A bucket of its own (the only isolation R2
	// can offer) is the app's to read whole.
	for _, loc := range out {
		if loc.target.Bucket == own.Bucket {
			add("the rest of its own (shared) bucket", own, "apps/")
			break
		}
	}
	return out
}

// probeIsolation runs the positive and negative tests for one instance key.
func probeIsolation(ctx context.Context, hosts storageHolders, key string, own state.S3Target) isolationReport {
	name, env, _ := strings.Cut(key, "/")
	prefix := deploy.BlobPrefix(name, env) + "/"
	report := isolationReport{Checks: []isolationCheck{}}

	client, err := s3.New(s3.Config{Endpoint: own.Endpoint, Bucket: own.Bucket,
		AccessKey: own.AccessKey, SecretKey: own.SecretKey, Region: own.Region})
	if err != nil {
		report.WorkError = err.Error()
		return report
	}
	probe := prefix + probeObject
	if err := client.Put(ctx, probe, []byte("bay isolation probe")); err != nil {
		report.WorkError = "cannot write under " + prefix + ": " + err.Error()
	} else {
		deleted := false
		if _, err := client.ListPage(ctx, prefix, 1); err != nil {
			report.WorkError = "cannot list " + prefix + ": " + err.Error()
		} else if err := client.Delete(ctx, probe); err != nil {
			report.WorkError = "cannot delete under " + prefix + ": " + err.Error()
		} else {
			deleted, report.Works = true, true
		}
		if !deleted {
			// Best effort, on a context of its own: the probe's may be the
			// one that just expired.
			cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			_ = client.Delete(cleanup, probe)
			cancel()
		}
	}

	report.Checks, report.Isolated = probeLocations(ctx, own, foreignLocations(hosts, key, own))
	return report
}

// probeObject is the key every probe writes, under the prefix it tries.
const probeObject = ".bay-isolation-probe"

// probeLocations tries cred against each location; isolated only when every
// one of them refused every operation.
func probeLocations(ctx context.Context, cred state.S3Target, locs []foreignLocation) ([]isolationCheck, bool) {
	checks := []isolationCheck{}
	isolated := true
	for _, loc := range locs {
		check := tryLocation(ctx, cred, loc)
		if check.Result != "denied" {
			isolated = false
		}
		checks = append(checks, check)
	}
	return checks, isolated
}

/*
tryLocation attempts list, get, put and delete at loc with cred.

The put writes a probe object; if it goes through, it is removed with the
location's OWN credential as well, since a write-only leak cannot delete what
it wrote. A get answered 404 is a leak too: S3 says "no such key" only to a
caller allowed to read there.
*/
func tryLocation(ctx context.Context, cred state.S3Target, loc foreignLocation) isolationCheck {
	check := isolationCheck{What: loc.what, Bucket: loc.target.Bucket, Prefix: loc.prefix}
	c, err := s3.New(s3.Config{Endpoint: loc.target.Endpoint, Bucket: loc.target.Bucket,
		AccessKey: cred.AccessKey, SecretKey: cred.SecretKey, Region: cred.Region})
	if err != nil {
		check.Result, check.Error = "unverified", err.Error()
		return check
	}
	key := loc.prefix + probeObject
	var errs []string
	try := func(op string, err error) {
		var se *s3.StatusError
		switch {
		case err == nil, op == "get" && errors.As(err, &se) && se.Code == http.StatusNotFound:
			check.Reached = append(check.Reached, op)
		case !s3.IsDenied(err):
			errs = append(errs, op+": "+err.Error())
		}
	}
	_, err = c.ListPage(ctx, loc.prefix, 1)
	try("list", err)
	_, err = c.Get(ctx, key)
	try("get", err)
	err = c.Put(ctx, key, []byte("bay isolation probe"))
	if err == nil {
		defer removeProbe(ctx, loc.target, key)
	}
	try("put", err)
	try("delete", c.Delete(ctx, key))

	switch {
	case len(check.Reached) > 0:
		check.Result = "reachable"
	case len(errs) > 0:
		check.Result = "unverified"
		check.Error = strings.Join(errs, "; ")
	default:
		check.Result = "denied"
	}
	return check
}

// removeProbe deletes a probe a leaky key managed to write, with the key that
// legitimately holds the location.
func removeProbe(ctx context.Context, holder state.S3Target, key string) {
	c, err := s3.New(s3.Config{Endpoint: holder.Endpoint, Bucket: holder.Bucket,
		AccessKey: holder.AccessKey, SecretKey: holder.SecretKey, Region: holder.Region})
	if err != nil {
		return
	}
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	_ = c.Delete(cleanup, key)
}

// instanceStorageRequest is the body of PUT /apps/{name}/{env}/storage.
type instanceStorageRequest struct {
	state.S3Target
	// AllowWide stores a key that failed the negative test. For a provider
	// that cannot scope a key to a prefix, where the honest fix is a bucket
	// per app. Never overrides sharing the BACKUP key.
	AllowWide bool `json:"allowWide,omitempty"`
	// Moved says the operator has already copied this instance's blobs to the
	// new bucket, so switching does not strand them.
	Moved bool `json:"moved,omitempty"`
}

func (s *server) registerIsolationRoutes(mux *http.ServeMux) {
	mux.HandleFunc("PUT /apps/{name}/{env}/storage", s.handleSetInstanceStorage)
	mux.HandleFunc("GET /apps/{name}/{env}/storage", s.handleGetInstanceStorage)
	mux.HandleFunc("DELETE /apps/{name}/{env}/storage", s.handleClearInstanceStorage)
}

func (s *server) handleSetInstanceStorage(w http.ResponseWriter, r *http.Request) {
	app, ok := s.store.Get(r.PathValue("name") + "/" + r.PathValue("env"))
	if !ok {
		writeError(w, http.StatusNotFound, "unknown app")
		return
	}
	var body instanceStorageRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json: "+err.Error())
		return
	}
	if body.Region == "" {
		body.Region = "auto"
	}
	target := body.S3Target
	key := app.Key()

	// Refusals that no flag lifts: these are not "could not prove it", they
	// are "proved it is shared".
	if b := s.store.S3(); b != nil && state.SameCredential(&b.S3Target, &target) {
		writeError(w, http.StatusConflict, "this is the BACKUP key: an app holding it can delete every backup on this host. Mint a separate key for "+key)
		return
	}
	if st := s.store.Storage(); state.SameCredential(st, &target) {
		writeError(w, http.StatusConflict, "this is the host-wide s3:apps key every other app already holds: it isolates nothing. Mint a key for "+key+" alone")
		return
	}
	for other, t := range s.store.AllInstanceStorage() {
		if other != key && state.SameCredential(&t, &target) {
			writeError(w, http.StatusConflict, "this key is already "+other+"'s: two apps holding one key can read each other's uploads")
			return
		}
	}

	// Moving buckets under an app that already stores blobs would leave them
	// behind, and the app would come up healthy serving 404s.
	instance := filepath.Join(s.root, "apps", naming.Instance(app.Name, app.Env))
	prev := s.store.StorageFor(key)
	if app.StorageBackend == deploy.BackendS3 {
		envNow, _ := runner.LoadEnvFile(filepath.Join(instance, ".env"))
		byo := prev == nil
		if envNow != nil && prev != nil {
			byo = strings.TrimRight(envNow["S3_ENDPOINT"], "/") != strings.TrimRight(prev.Endpoint, "/") ||
				envNow["S3_BUCKET_NAME"] != prev.Bucket || envNow["S3_ACCESS_KEY_ID"] != prev.AccessKey
		}
		if byo {
			writeError(w, http.StatusConflict, key+" brings its own bucket through its secrets (S3_*): Bay does not manage that key. Remove S3_* from its secrets first")
			return
		}
		if !body.Moved && (strings.TrimRight(prev.Endpoint, "/") != strings.TrimRight(target.Endpoint, "/") || prev.Bucket != target.Bucket) {
			writeError(w, http.StatusConflict, fmt.Sprintf(
				"%s keeps its uploads in %s/%s under %s/: copy them to %s first, then repeat with --moved",
				key, prev.Endpoint, prev.Bucket, deploy.BlobPrefix(app.Name, app.Env), target.Bucket))
			return
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), storageProbeTimeout)
	defer cancel()
	report := probeIsolation(ctx, s.storageHolders(), key, target)
	if !report.Works {
		writeError(w, http.StatusBadRequest, "this key does not work for "+key+": "+report.WorkError,
			map[string]any{"isolation": report})
		return
	}
	if !report.Isolated && !body.AllowWide {
		writeError(w, http.StatusConflict,
			"this key reaches data that is not "+key+"'s (see isolation.checks). Scope it to "+
				deploy.BlobPrefix(app.Name, app.Env)+"/ or give the app a bucket of its own; --allow-wide-key stores it anyway",
			map[string]any{"isolation": report})
		return
	}

	if err := s.store.SetInstanceStorage(key, &target); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !report.Isolated {
		s.log.Warn("instance upload key stored although it is NOT isolated", "app", key)
	}
	s.log.Info("instance upload key configured", "app", key, "bucket", target.Bucket, "isolated", report.Isolated)

	resp := map[string]any{"app": key, "bucket": target.Bucket, "isolation": report}
	// An app already on S3 holds the old key in its .env until something
	// rewrites it; leaving it there would make the new key decorative.
	if app.StorageBackend == deploy.BackendS3 {
		if err := s.swapStorageKey(app, instance, &target); err != nil {
			writeError(w, http.StatusInternalServerError, "key stored, but the app was not switched to it: "+err.Error(),
				map[string]any{"isolation": report})
			return
		}
		resp["applied"] = "the app's .env now holds this key and the app was restarted"
	} else {
		resp["applied"] = "used from the next deploy (run `bay storage migrate " + key + "` if it has files on disk)"
	}
	writeJSON(w, http.StatusOK, resp)
}

// swapStorageKey rewrites the instance's storage keys and restarts it if it
// was running. Requests wait rather than fail meanwhile.
func (s *server) swapStorageKey(app state.App, instance string, target *state.S3Target) error {
	repoint := s.repoint
	if repoint == nil {
		repoint = deploy.RepointStorage
	}
	defer s.holdDuring(app.Key())()
	wasRunning := s.runner.Running(app.Key())
	if wasRunning {
		_ = s.runner.Stop(app.Key(), stopGrace)
	}
	if err := repoint(instance, app.Name, app.Env, target); err != nil {
		if wasRunning {
			_ = s.start(app)
		}
		return err
	}
	if wasRunning {
		return s.start(app)
	}
	return nil
}

func (s *server) handleGetInstanceStorage(w http.ResponseWriter, r *http.Request) {
	app, ok := s.store.Get(r.PathValue("name") + "/" + r.PathValue("env"))
	if !ok {
		writeError(w, http.StatusNotFound, "unknown app")
		return
	}
	own := s.store.InstanceStorage(app.Key())
	if own == nil {
		writeJSON(w, http.StatusOK, map[string]any{"app": app.Key(), "ownKey": false,
			"hostWide": s.store.Storage() != nil})
		return
	}
	// Never the secret, same rule as GET /config/storage.
	resp := map[string]any{"app": app.Key(), "ownKey": true,
		"endpoint": own.Endpoint, "bucket": own.Bucket, "region": own.Region}
	if r.URL.Query().Get("check") == "yes" {
		ctx, cancel := context.WithTimeout(r.Context(), storageProbeTimeout)
		defer cancel()
		resp["isolation"] = probeIsolation(ctx, s.storageHolders(), app.Key(), *own)
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *server) handleClearInstanceStorage(w http.ResponseWriter, r *http.Request) {
	app, ok := s.store.Get(r.PathValue("name") + "/" + r.PathValue("env"))
	if !ok {
		writeError(w, http.StatusNotFound, "unknown app")
		return
	}
	if s.store.InstanceStorage(app.Key()) == nil {
		writeJSON(w, http.StatusOK, map[string]any{"app": app.Key(), "ownKey": false})
		return
	}
	// Falling back to the host-wide key widens what the app can reach; an app
	// already on S3 would also need its .env rewritten. Both are decisions,
	// so this only works for an app not yet storing in a bucket.
	if app.StorageBackend == deploy.BackendS3 {
		writeError(w, http.StatusConflict, app.Key()+" stores its uploads with this key; replace it with another `bay config s3:apps "+app.Key()+"` rather than removing it")
		return
	}
	if err := s.store.SetInstanceStorage(app.Key(), nil); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"app": app.Key(), "ownKey": false})
}

// ---------------------------------------------------------------------------
// client command
// ---------------------------------------------------------------------------

// cmdConfigInstanceStorage is `bay config s3:apps <name/env> ...`.
func cmdConfigInstanceStorage(args []string) error {
	key, err := appKeyArg(args, "bay config s3:apps <name/env> --endpoint URL --bucket NAME [--allow-wide-key] [--moved] | --clear | --check")
	if err != nil {
		return err
	}
	path := controlHost + "/apps/" + key + "/storage"
	body := instanceStorageRequest{S3Target: state.S3Target{Region: "auto"}}
	for i := 1; i < len(args); i++ {
		switch args[i] {
		case "--clear":
			res, err := call(http.MethodDelete, path, nil)
			if err == nil {
				fmt.Println(res)
			}
			return err
		case "--check":
			res, err := call(http.MethodGet, path+"?check=yes", nil)
			if err == nil {
				fmt.Println(res)
			}
			return err
		case "--allow-wide-key":
			body.AllowWide = true
		case "--moved":
			body.Moved = true
		case "--endpoint", "--bucket", "--region":
			if i+1 >= len(args) {
				return errors.New(args[i] + " needs a value")
			}
			switch args[i] {
			case "--endpoint":
				body.Endpoint = args[i+1]
			case "--bucket":
				body.Bucket = args[i+1]
			default:
				body.Region = args[i+1]
			}
			i++
		}
	}
	body.AccessKey = os.Getenv("BAY_STORAGE_ACCESS_KEY")
	body.SecretKey = os.Getenv("BAY_STORAGE_SECRET_KEY")
	if body.AccessKey == "" || body.SecretKey == "" {
		return errors.New("set BAY_STORAGE_ACCESS_KEY and BAY_STORAGE_SECRET_KEY to this app's own key")
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	res, err := call(http.MethodPut, path, bytesReader(raw))
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

func hasFlag(args []string, flag string) bool {
	for _, a := range args {
		if a == flag {
			return true
		}
	}
	return false
}
