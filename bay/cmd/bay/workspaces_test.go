package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alepha-dev/bay/internal/connector"
)

func TestJobWorkspaces(t *testing.T) {
	t.Run("lists the workspaces jobs left, and removes one, then a whole project", func(t *testing.T) {
		w := newJobWorld(t)
		w.stub(t, "claude", "#!/bin/sh\ntouch here\n")
		for id, ws := range map[string]string{"j1": "triage", "j2": "q12"} {
			if last := w.run(id, w.agentSpec(map[string]any{"workspace": ws})).last(); last.Status != "done" {
				t.Fatalf("ack = %+v", last)
			}
		}
		if last := w.run("j3", w.agentSpec(map[string]any{"project": "other"})).last(); last.Status != "done" {
			t.Fatalf("ack = %+v", last)
		}
		r := w.acts.jobs.runner
		u, err := r.jobsUser()
		if err != nil {
			t.Fatal(err)
		}
		list, _ := r.workspaces(u)
		var names []string
		for _, ws := range list {
			names = append(names, ws.Project+"/"+ws.Name)
		}
		if strings.Join(names, " ") != "acme/q12 acme/triage other/triage" {
			t.Fatalf("workspaces = %v", names)
		}

		rm := &ackRecorder{}
		w.acts.Command(context.Background(), connector.Command{ID: "rm-1", Kind: "job-workspace-remove", Project: "acme", Workspace: "q12"}, rm.send)
		if rm.last().Status != "done" {
			t.Fatalf("ack = %+v", rm.last())
		}
		if _, err := os.Stat(filepath.Join(w.work, "acme", "q12")); !os.IsNotExist(err) {
			t.Fatal("the workspace is still there")
		}
		if _, err := os.Stat(filepath.Join(w.work, "acme", "triage")); err != nil {
			t.Fatal("a sibling workspace went too")
		}

		all := &ackRecorder{}
		w.acts.Command(context.Background(), connector.Command{ID: "rm-2", Kind: "job-workspace-remove", Project: "acme"}, all.send)
		if all.last().Status != "done" {
			t.Fatalf("ack = %+v", all.last())
		}
		if _, err := os.Stat(filepath.Join(w.work, "acme")); !os.IsNotExist(err) {
			t.Fatal("the project's workspaces are still there")
		}
		if _, err := os.Stat(filepath.Join(w.work, "other", "triage")); err != nil {
			t.Fatal("another project's workspace went too")
		}
		// Gone is gone: asking again is not an error.
		again := &ackRecorder{}
		w.acts.Command(context.Background(), connector.Command{ID: "rm-3", Kind: "job-workspace-remove", Project: "acme", Workspace: "q12"}, again.send)
		if again.last().Status != "done" {
			t.Fatalf("ack = %+v", again.last())
		}
	})

	t.Run("refuses to remove a workspace a job runs in, and a name that climbs", func(t *testing.T) {
		w := newJobWorld(t)
		w.stub(t, "claude", "#!/bin/sh\nsleep 30 &\nwait\n")
		go w.run("job-a", w.agentSpec(map[string]any{"timeoutSeconds": 3600}))
		waitFor(t, func() bool { return strings.Contains(w.frames.text("stderr"), "agent started") })
		rm := &ackRecorder{}
		w.acts.Command(context.Background(), connector.Command{ID: "rm-busy", Kind: "job-workspace-remove", Project: "acme"}, rm.send)
		if rm.last().Status != "failed" || !strings.Contains(rm.last().Reason, "already runs") {
			t.Fatalf("ack = %+v", rm.last())
		}
		if _, err := os.Stat(filepath.Join(w.work, "acme", "triage")); err != nil {
			t.Fatal("a busy workspace was removed")
		}
		w.acts.jobs.stop("job-a")
		waitFor(t, func() bool { return w.acts.jobs.runningIDs() == "" })

		bad := &ackRecorder{}
		w.acts.Command(context.Background(), connector.Command{ID: "rm-bad", Kind: "job-workspace-remove", Project: "acme", Workspace: ".."}, bad.send)
		if bad.last().Status != "failed" {
			t.Fatalf("ack = %+v", bad.last())
		}
	})
}
