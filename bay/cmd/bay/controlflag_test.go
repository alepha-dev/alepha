package main

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// recordingControlAPI answers every call and keeps the last request's query.
func recordingControlAPI(t *testing.T) (socket string, query *string) {
	t.Helper()
	socket = controlSocket(t)
	query = new(string)
	serveSocket(t, socket, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*query = r.URL.RawQuery
		_, _ = w.Write([]byte("[]"))
	}))
	return socket, query
}

// `--control-socket` is read wherever it sits, and appended last by anything
// that adds it to every command, as `BayAdapter.bayArgv` does.
func TestStackBackupLeavesTheControlFlagOutOfItsArguments(t *testing.T) {
	t.Run("list does not take it for a service", func(t *testing.T) {
		socket, query := recordingControlAPI(t)

		if err := cmdStackBackup("list", []string{"mcs/production", "--control-socket", socket}); err != nil {
			t.Fatal(err)
		}

		if *query != "" {
			t.Fatalf("query = %q", *query)
		}
	})

	t.Run("list still narrows to a service", func(t *testing.T) {
		socket, query := recordingControlAPI(t)

		if err := cmdStackBackup("list", []string{"mcs/production", "db", "--control-socket", socket}); err != nil {
			t.Fatal(err)
		}

		if *query != "service=db" {
			t.Fatalf("query = %q", *query)
		}
	})

	t.Run("list refuses a flag it does not know", func(t *testing.T) {
		recordingControlAPI(t)

		if err := cmdStackBackup("list", []string{"mcs/production", "--servcie", "db"}); err == nil {
			t.Fatal("a typo must not become a service name")
		}
	})

	t.Run("restore accepts it", func(t *testing.T) {
		socket, query := recordingControlAPI(t)

		err := cmdStackBackup("restore", []string{
			"mcs/production", "db", "20261024T120000Z.dump.gz", "--yes", "--control-socket", socket})
		if err != nil {
			t.Fatal(err)
		}

		if !strings.Contains(*query, "service=db") {
			t.Fatalf("query = %q", *query)
		}
	})
}

// A stand-in `docker`, since `stack exec` runs the real one: what it was given
// is the whole question.
func TestStackExecLeavesTheControlFlagOutOfTheContainerCommand(t *testing.T) {
	bin := t.TempDir()
	argv := filepath.Join(bin, "argv")
	script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > " + argv + "\n"
	if err := os.WriteFile(filepath.Join(bin, "docker"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))

	err := cmdStackExec([]string{"mcs/production", "db", "psql", "-U", "app", "--control-socket", "/run/bay/control.sock"})
	if err != nil {
		t.Fatal(err)
	}

	got, err := os.ReadFile(argv)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(got), "control") {
		t.Fatalf("the container command was given Bay's flag:\n%s", got)
	}
	if !strings.HasSuffix(string(got), "psql\n-U\napp\n") {
		t.Fatalf("the container command lost its own arguments:\n%s", got)
	}
}
