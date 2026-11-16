package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/health"
	"github.com/alepha-dev/bay/internal/naming"
	"github.com/alepha-dev/bay/internal/runner"
	"github.com/alepha-dev/bay/internal/state"
)

// containerIdentity reads a container's id and start time straight from the
// daemon: the two things a recreated container cannot keep.
func containerIdentity(t *testing.T, key string) (id, startedAt string) {
	t.Helper()
	socket := runner.DefaultDockerSocket
	if path, ok := strings.CutPrefix(os.Getenv("DOCKER_HOST"), "unix://"); ok {
		socket = path
	}
	client := &http.Client{Transport: &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", socket)
		},
	}}
	res, err := client.Get("http://docker/containers/bay-" + naming.Instance(strings.Split(key, "/")[0], strings.Split(key, "/")[1]) + "/json")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var info struct {
		ID    string `json:"Id"`
		State struct {
			StartedAt string `json:"StartedAt"`
		} `json:"State"`
	}
	if err := json.NewDecoder(res.Body).Decode(&info); err != nil || info.ID == "" {
		t.Fatalf("inspect %s: status %d, err %v", key, res.StatusCode, err)
	}
	return info.ID, info.State.StartedAt
}

/*
A Bay restart leaves a running app alone (#Q3742).

`rebooted` is a second server over the same root and the same daemon, which is
what a restarted Bay is: nothing in memory, the state file and the containers
as the first one left them. restoreApps is what cmdServe runs on the way up.
*/
func TestBootAdoptsARunningContainerDaemon(t *testing.T) {
	d := daemonDocker(t)
	root := daemonRoot(t, d)
	boot := func() (*server, *bytes.Buffer) {
		store, err := state.Open(filepath.Join(root, "state.json"))
		if err != nil {
			t.Fatal(err)
		}
		var log bytes.Buffer
		return &server{
			root: root, store: store, runner: d, probe: &health.Probe{},
			log:          slog.New(slog.NewTextHandler(&log, nil)),
			keepReleases: defaultKeepReleases,
		}, &log
	}
	s, _ := boot()
	if err := s.store.SetBaseDomain("bay.test"); err != nil {
		t.Fatal(err)
	}
	env := "adopt" + strconv.FormatInt(time.Now().UnixNano()%1e9, 36)
	key := "sqlitedemo/" + env
	t.Cleanup(func() { _ = d.Remove(key, true) })
	if _, failure := s.deployArtifact(context.Background(), deployArtifactOptions{
		Artifact: sqliteAppArtifact(t), Name: "sqlitedemo", Env: env,
	}); failure != nil {
		lines, _, _ := d.Logs(key, 50)
		t.Fatalf("deploy: %v\napp logs: %+v", failure, lines)
	}
	id, startedAt := containerIdentity(t, key)

	t.Run("a restarted Bay adopts the container: same id, same start time", func(t *testing.T) {
		rebooted, log := boot()
		rebooted.restoreApps()
		gotID, gotStart := containerIdentity(t, key)
		if gotID != id || gotStart != startedAt {
			t.Fatalf("the container was replaced: id %s -> %s, started %s -> %s\n%s", id, gotID, startedAt, gotStart, log)
		}
		if !strings.Contains(log.String(), `msg="app adopted" app=`+key) {
			t.Fatalf("log = %s", log)
		}
	})

	t.Run("after a blue/green restart the promoted container is adopted too", func(t *testing.T) {
		app, _ := s.store.Get(key)
		if err := s.restart(app); err != nil {
			t.Fatal(err)
		}
		id, startedAt = containerIdentity(t, key)
		rebooted, log := boot()
		rebooted.restoreApps()
		if gotID, _ := containerIdentity(t, key); gotID != id {
			t.Fatalf("the promoted container was replaced\n%s", log)
		}
	})

	t.Run("a definition that changed while Bay was down starts the app again", func(t *testing.T) {
		app, _ := s.store.Get(key)
		envFile := filepath.Join(s.instanceDir(app), ".env")
		f, err := os.OpenFile(envFile, os.O_APPEND|os.O_WRONLY, 0)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.WriteString("ADDED_WHILE_DOWN=1\n"); err != nil {
			t.Fatal(err)
		}
		f.Close()
		rebooted, log := boot()
		rebooted.restoreApps()
		gotID, _ := containerIdentity(t, key)
		if gotID == id {
			t.Fatalf("the container kept running on a definition Bay no longer holds\n%s", log)
		}
		if !strings.Contains(log.String(), `msg="app started" app=`+key+` reason="spec changed"`) {
			t.Fatalf("log = %s", log)
		}
		id = gotID
	})

	t.Run("a container that died while Bay was down is started", func(t *testing.T) {
		if err := d.Stop(key, time.Second); err != nil {
			t.Fatal(err)
		}
		rebooted, log := boot()
		rebooted.restoreApps()
		if !d.Running(key) || !strings.Contains(log.String(), `reason="not running"`) {
			t.Fatalf("running = %v, log = %s", d.Running(key), log)
		}
	})
}
