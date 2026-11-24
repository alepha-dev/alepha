package main

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestSignIns(t *testing.T) {
	t.Run("reads each tool's own status command, and a signed-in lore is a warning, not a requirement", func(t *testing.T) {
		w := newJobWorld(t)
		w.stub(t, "claude", `#!/bin/sh
[ "$1" = --version ] && { echo "2.1.7 (Claude Code)"; exit 0; }
[ "$1" = auth ] && { echo '{"loggedIn": true, "authMethod": "claude.ai", "email": "ops@example.com"}'; exit 0; }
exit 0
`)
		w.stub(t, "gemini", "#!/bin/sh\necho 0.9.0\n")
		w.stub(t, "gh", `#!/bin/sh
[ "$1" = --version ] && { echo "gh version 2.40.1"; exit 0; }
echo "  Logged in to github.com account octo-ops (keyring)" >&2
`)
		w.stub(t, "cf", `#!/bin/sh
[ "$1" = --version ] && { printf '\360\237\215\212\342\230\201\357\270\217  cf \302\267 v0.15.0\n'; exit 0; }
echo '{"authenticated": false}'
`)
		w.stub(t, "lore", "#!/bin/sh\n[ \"$1\" = --version ] && { echo 0.38.0; exit 0; }\nexit 0\n")
		u, _ := w.acts.jobs.runner.jobsUser()
		by := map[string]string{}
		for _, tool := range w.acts.jobs.runner.tools(context.Background(), u) {
			state := "unknown"
			if tool.SignedIn != nil && *tool.SignedIn {
				state = "in:" + tool.Account
			} else if tool.SignedIn != nil {
				state = "out"
			}
			by[tool.Name] = state
		}
		for name, want := range map[string]string{
			"claude": "in:ops@example.com",
			"gemini": "unknown",
			"gh":     "in:octo-ops",
			"cf":     "out",
			"lore":   "in:",
		} {
			if by[name] != want {
				t.Errorf("%s reads %q, want %q", name, by[name], want)
			}
		}
		if by["git"] != "" && by["git"] != "unknown" {
			t.Errorf("git has a sign-in: %q", by["git"])
		}
		// A signed-in lore never fails a job: it is the doctor's warning.
		if last := w.run("job-lore", w.agentSpec(nil)).last(); last.Status != "done" {
			t.Fatalf("ack = %+v", last)
		}
	})

	t.Run("a job fails at once when its agent CLI is signed out, naming the tool and the command", func(t *testing.T) {
		w := newJobWorld(t)
		w.stub(t, "claude", `#!/bin/sh
[ "$1" = auth ] && { echo '{"loggedIn": false, "authMethod": "none"}'; exit 0; }
touch "`+w.bin+`/ran"
`)
		last := w.run("job-1", w.agentSpec(nil)).last()
		u, _ := w.acts.jobs.runner.jobsUser()
		if last.Status != "failed" || last.Reason != "the jobs user's claude CLI is signed out: sudo -iu "+u.Username+" claude auth login" {
			t.Fatalf("ack = %+v", last)
		}
		if strings.Contains(w.frames.textOf("job-1", "stderr"), "workspace") {
			t.Fatal("the job reached its workspace before failing")
		}
		if fileExists(w.bin + "/ran") {
			t.Fatal("the agent ran signed out")
		}
	})

	t.Run("a read or write job fails when gh is signed out; a job with no source does not need gh", func(t *testing.T) {
		origin := originRepo(t)
		w := newJobWorld(t)
		w.stub(t, "claude", "#!/bin/sh\n[ \"$1\" = auth ] && exit 0\ntrue\n")
		w.stub(t, "gh", "#!/bin/sh\necho 'You are not logged into any GitHub hosts.' >&2\nexit 1\n")
		read := w.run("job-1", w.agentSpec(map[string]any{"source": map[string]any{"mode": "read", "repository": origin}})).last()
		u, _ := w.acts.jobs.runner.jobsUser()
		if read.Status != "failed" || read.Reason != "the jobs user's gh CLI is signed out: sudo -iu "+u.Username+" gh auth login" {
			t.Fatalf("ack = %+v", read)
		}
		if fileExists(w.work + "/acme/" + mirrorName) {
			t.Fatal("a job failed on gh still touched git")
		}
		if none := w.run("job-2", w.agentSpec(nil)).last(); none.Status != "done" {
			t.Fatalf("a job needing no gh failed on it: %+v", none)
		}
	})
}

func fileExists(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}
