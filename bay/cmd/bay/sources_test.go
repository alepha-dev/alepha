package main

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/connector"
)

// gitT runs git in dir for a test's own setup, failing the test on error.
func gitT(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "init.defaultBranch=main"}, args...)...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return strings.TrimSpace(string(out))
}

/*
originRepo makes a repository standing in for the project's GitHub one: a
`main` with one commit, a `feature` branch one commit ahead, and a tag. A dev
build running jobs as itself takes its absolute path in place of a GitHub URL
(localRepositoriesAllowed), which the test turns on.
*/
func originRepo(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	t.Setenv("BAY_DEV_JOBS_AS_SELF", "1")
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	gitT(t, dir, "init", "--quiet")
	gitT(t, dir, "checkout", "--quiet", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitT(t, dir, "add", "README.md")
	gitT(t, dir, "commit", "--quiet", "-m", "first")
	gitT(t, dir, "tag", "v1")
	gitT(t, dir, "checkout", "--quiet", "-b", "feature")
	if err := os.WriteFile(filepath.Join(dir, "feature.txt"), []byte("feature\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitT(t, dir, "add", "feature.txt")
	gitT(t, dir, "commit", "--quiet", "-m", "feature")
	gitT(t, dir, "checkout", "--quiet", "main")
	return dir
}

// commitTo adds a commit to a branch of the origin, and answers its sha.
func commitTo(t *testing.T, origin, branch, file string) string {
	t.Helper()
	gitT(t, origin, "checkout", "--quiet", branch)
	if err := os.WriteFile(filepath.Join(origin, file), []byte(file+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitT(t, origin, "add", file)
	gitT(t, origin, "commit", "--quiet", "-m", file)
	sha := gitT(t, origin, "rev-parse", "HEAD")
	gitT(t, origin, "checkout", "--quiet", "main")
	return sha
}

func setFetchTTL(t *testing.T, w *jobWorld, seconds int) {
	t.Helper()
	cfg, _ := loadJobsConfig(w.f.root)
	cfg.FetchTTLSeconds = &seconds
	if err := saveJobsConfig(w.f.root, cfg); err != nil {
		t.Fatal(err)
	}
}

func TestJobSourceValidation(t *testing.T) {
	sink := "https://lore.example.com"
	base := func(source map[string]any) map[string]any {
		m := map[string]any{
			"kind": "agent", "agent": "claude",
			"project": "acme", "workspace": "triage",
			"key":    "lore_job_0123456789abcdef",
			"mcpUrl": sink + "/mcp", "prompt": "Read it.", "timeoutSeconds": 600,
		}
		if source != nil {
			m["source"] = source
		}
		return m
	}
	parse := func(m map[string]any) error {
		raw, _ := json.Marshal(m)
		_, err := parseJobSpec(raw, sink)
		return err
	}
	repo := "https://github.com/acme/app"
	accepted := map[string]map[string]any{
		"no source":            nil,
		"none":                 {"mode": "none"},
		"read, default branch": {"mode": "read", "repository": repo},
		"read at a branch":     {"mode": "read", "repository": repo, "ref": "release/1.2"},
		"read at a tag":        {"mode": "read", "repository": repo, "ref": "v1.2.3"},
		"read at a commit":     {"mode": "read", "repository": repo, "ref": strings.Repeat("ab", 20)},
		"read at a PR head":    {"mode": "read", "repository": "https://github.com/acme/app.js", "ref": "pull/42/head", "trust": "pr-author-writes"},
		"write on a branch":    {"mode": "write", "repository": repo, "branch": "lore/q12"},
		"write from a ref":     {"mode": "write", "repository": repo, "branch": "lore/job-0b3c", "ref": "main"},
	}
	for name, source := range accepted {
		if err := parse(base(source)); err != nil {
			t.Errorf("%s was refused: %v", name, err)
		}
	}
	refused := map[string]map[string]any{
		"an unknown mode":           {"mode": "clone", "repository": repo},
		"an unknown field":          {"mode": "read", "repository": repo, "depth": 1},
		"read with no repository":   {"mode": "read"},
		"a repository off GitHub":   {"mode": "read", "repository": "https://gitlab.com/acme/app"},
		"an ssh repository":         {"mode": "read", "repository": "git@github.com:acme/app.git"},
		"a repository with a path":  {"mode": "read", "repository": "https://github.com/acme/app/tree/main"},
		"a repository climbing":     {"mode": "read", "repository": "https://github.com/acme/.."},
		"a local path, released":    {"mode": "read", "repository": "/srv/repo"},
		"a ref that is an option":   {"mode": "read", "repository": repo, "ref": "--upload-pack=sh"},
		"a ref with ..":             {"mode": "read", "repository": repo, "ref": "a..b"},
		"a ref ending in .lock":     {"mode": "read", "repository": repo, "ref": "main.lock"},
		"a ref with a space":        {"mode": "read", "repository": repo, "ref": "my branch"},
		"a reflog ref":              {"mode": "read", "repository": repo, "ref": "main@{1}"},
		"read with a branch":        {"mode": "read", "repository": repo, "branch": "lore/q1"},
		"write with no branch":      {"mode": "write", "repository": repo},
		"write on a pull ref":       {"mode": "write", "repository": repo, "branch": "pull/1/head"},
		"a branch that is a flag":   {"mode": "write", "repository": repo, "branch": "-f"},
		"none with a repository":    {"mode": "none", "repository": repo},
		"an unknown trust":          {"mode": "read", "repository": repo, "ref": "pull/1/head", "trust": "anyone"},
		"a trust off a pull ref":    {"mode": "read", "repository": repo, "ref": "main", "trust": "pr-author-writes"},
		"a pull ref with a zero":    {"mode": "read", "repository": repo, "ref": "pull/0/head", "trust": "pr-author-writes"},
		"a source that is a string": nil,
	}
	for name, source := range refused {
		m := base(source)
		if source == nil {
			m["source"] = "read"
		}
		if err := parse(m); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	check := map[string]any{"kind": "check", "agent": "claude", "timeoutSeconds": 60, "source": map[string]any{"mode": "none"}}
	if err := parse(check); err == nil {
		t.Error("a check took a source")
	}
}

func TestJobMirror(t *testing.T) {
	t.Run("a read job clones the mirror once, then reuses a fresh one, and the agent never fetches", func(t *testing.T) {
		origin := originRepo(t)
		w := newJobWorld(t)
		w.stub(t, "claude", "#!/bin/sh\ntrue\n")
		src := map[string]any{"mode": "read", "repository": origin}
		rec := w.run("job-1", w.agentSpec(map[string]any{"source": src}))
		if last := rec.last(); last.Status != "done" {
			t.Fatalf("ack = %+v", last)
		}
		log := w.frames.textOf("job-1", "stderr")
		main := gitT(t, origin, "rev-parse", "main")
		if !strings.Contains(log, "mirror fetched "+main[:12]) || !strings.Contains(log, "the default branch is "+main) {
			t.Fatalf("the log does not say the mirror was fetched at main: %q", log)
		}
		mirror := filepath.Join(w.work, "acme", mirrorName)
		// A bare clone, its remote branches under refs/remotes, its tags,
		// and no branch of its own.
		if got := gitT(t, mirror, "rev-parse", "--is-bare-repository"); got != "true" {
			t.Fatalf("the mirror is not bare: %s", got)
		}
		if got := gitT(t, mirror, "for-each-ref", "--format=%(refname)"); got != strings.Join([]string{
			"refs/remotes/origin/HEAD", "refs/remotes/origin/feature", "refs/remotes/origin/main", "refs/tags/v1"}, "\n") {
			t.Fatalf("the mirror's refs are\n%s", got)
		}
		if got := gitT(t, mirror, "config", "--local", "--get-all", "credential.https://github.com.helper"); got != "!gh auth git-credential" { // after an empty helper, trimmed
			t.Fatalf("the mirror's credential helper is %q", got)
		}

		if last := w.run("job-2", w.agentSpec(map[string]any{"source": src})).last(); last.Status != "done" {
			t.Fatalf("ack = %+v", last)
		}
		if log := w.frames.textOf("job-2", "stderr"); !strings.Contains(log, "mirror fresh, fetched") {
			t.Fatalf("a second read within the fetch TTL fetched again: %q", log)
		}
	})

	t.Run("a fetch leaves the mirror's local branches alone, and follows the remote", func(t *testing.T) {
		origin := originRepo(t)
		w := newJobWorld(t)
		setFetchTTL(t, w, 0)
		w.stub(t, "claude", "#!/bin/sh\ntrue\n")
		src := map[string]any{"mode": "read", "repository": origin}
		if last := w.run("job-1", w.agentSpec(map[string]any{"source": src})).last(); last.Status != "done" {
			t.Fatalf("ack = %+v", last)
		}
		mirror := filepath.Join(w.work, "acme", mirrorName)
		// A write worktree's branch, not pushed: a fetch must never prune it.
		local := gitT(t, mirror, "rev-parse", "refs/remotes/origin/main")
		gitT(t, mirror, "update-ref", "refs/heads/lore/q1", local)

		next := commitTo(t, origin, "main", "second.txt")
		gitT(t, origin, "branch", "-D", "feature")
		if last := w.run("job-2", w.agentSpec(map[string]any{"source": src})).last(); last.Status != "done" {
			t.Fatalf("ack = %+v", last)
		}
		if got := gitT(t, mirror, "rev-parse", "refs/heads/lore/q1"); got != local {
			t.Fatalf("the local branch moved to %s", got)
		}
		if got := gitT(t, mirror, "rev-parse", "refs/remotes/origin/main"); got != next {
			t.Fatalf("origin/main is %s, want %s", got, next)
		}
		if out, _ := exec.Command("git", "-C", mirror, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/feature").Output(); len(out) != 0 {
			t.Fatal("a branch deleted on the remote is still in the mirror")
		}
	})

	t.Run("a ref the mirror does not know yet is fetched once more, a ref nobody has fails the job", func(t *testing.T) {
		origin := originRepo(t)
		w := newJobWorld(t)
		w.stub(t, "claude", "#!/bin/sh\ntouch \""+w.bin+"/ran\"\n")
		src := map[string]any{"mode": "read", "repository": origin}
		if last := w.run("job-1", w.agentSpec(map[string]any{"source": src})).last(); last.Status != "done" {
			t.Fatalf("ack = %+v", last)
		}
		// Pushed a second ago: the mirror is fresh but does not have it.
		gitT(t, origin, "branch", "hotfix")
		if last := w.run("job-2", w.agentSpec(map[string]any{"source": map[string]any{"mode": "read", "repository": origin, "ref": "hotfix"}})).last(); last.Status != "done" {
			t.Fatalf("ack = %+v", last)
		}
		_ = os.Remove(filepath.Join(w.bin, "ran"))
		last := w.run("job-3", w.agentSpec(map[string]any{"source": map[string]any{"mode": "read", "repository": origin, "ref": "nope"}})).last()
		if last.Status != "failed" || !strings.Contains(last.Reason, `"nope" is no branch, tag, commit or pull request head`) {
			t.Fatalf("ack = %+v", last)
		}
		if _, err := os.Stat(filepath.Join(w.bin, "ran")); err == nil {
			t.Fatal("the agent ran on a ref that does not exist")
		}
	})

	t.Run("a failed fetch fails the job with git's message, before the agent starts", func(t *testing.T) {
		originRepo(t)
		w := newJobWorld(t)
		w.stub(t, "claude", "#!/bin/sh\ntouch \""+w.bin+"/ran\"\n")
		missing := filepath.Join(w.work, "no-such-repo")
		last := w.run("job-1", w.agentSpec(map[string]any{"source": map[string]any{"mode": "read", "repository": missing}})).last()
		if last.Status != "failed" || !strings.Contains(last.Reason, "could not fetch "+missing+": git fetch:") || !strings.Contains(strings.ToLower(last.Reason), "repository") {
			t.Fatalf("ack = %+v", last)
		}
		if _, err := os.Stat(filepath.Join(w.bin, "ran")); err == nil {
			t.Fatal("the agent ran after a failed fetch")
		}
	})

	t.Run("the mirror lock serialises a fetch, and a waiter gives up with its context", func(t *testing.T) {
		origin := originRepo(t)
		w := newJobWorld(t)
		r := w.acts.jobs.runner
		u, err := r.jobsUser()
		if err != nil {
			t.Fatal(err)
		}
		unlock, err := lockMirror(context.Background(), w.f.root, "acme")
		if err != nil {
			t.Fatal(err)
		}
		log, _ := openJobLog(w.f.root, "lock-test")
		ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
		defer cancel()
		if err := r.syncMirror(ctx, u, "acme", origin, false, log); err == nil || !strings.Contains(err.Error(), "stayed locked") {
			t.Fatalf("a fetch under a held lock answered %v", err)
		}
		if _, err := tryLockMirror(w.f.root, "acme"); err == nil {
			t.Fatal("a removal took a held mirror lock")
		}
		unlock()
		if err := r.syncMirror(context.Background(), u, "acme", origin, false, log); err != nil {
			t.Fatalf("a fetch after the lock was released: %v", err)
		}
	})

	t.Run("bay jobs workspaces lists the mirror, and removing the project removes it", func(t *testing.T) {
		origin := originRepo(t)
		w := newJobWorld(t)
		w.stub(t, "claude", "#!/bin/sh\ntrue\n")
		if last := w.run("job-1", w.agentSpec(map[string]any{"source": map[string]any{"mode": "read", "repository": origin}})).last(); last.Status != "done" {
			t.Fatalf("ack = %+v", last)
		}
		r := w.acts.jobs.runner
		u, _ := r.jobsUser()
		list, _ := r.workspaces(u)
		var names []string
		for _, ws := range list {
			names = append(names, ws.Project+"/"+ws.Name+":"+ws.Kind)
		}
		if strings.Join(names, " ") != "acme/.mirror:mirror acme/triage:workspace" {
			t.Fatalf("workspaces = %v", names)
		}
		rm := &ackRecorder{}
		w.acts.Command(context.Background(), connector.Command{ID: "rm-1", Kind: "job-workspace-remove", Project: "acme"}, rm.send)
		if rm.last().Status != "done" {
			t.Fatalf("ack = %+v", rm.last())
		}
		if _, err := os.Stat(filepath.Join(w.work, "acme", mirrorName)); !os.IsNotExist(err) {
			t.Fatal("the mirror outlived its project's removal")
		}
	})
}

func TestParseFetchTTL(t *testing.T) {
	for raw, want := range map[string]int{"30s": 30, "2m": 120, "0": 0, "45": 45} {
		if got, err := parseFetchTTL(raw); err != nil || got != want {
			t.Errorf("parseFetchTTL(%q) = %d, %v; want %d", raw, got, err, want)
		}
	}
	for _, raw := range []string{"-1s", "2h", "soon"} {
		if _, err := parseFetchTTL(raw); err == nil {
			t.Errorf("parseFetchTTL(%q) was accepted", raw)
		}
	}
}
