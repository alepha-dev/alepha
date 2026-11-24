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
		w.stub(t, "claude", "#!/bin/sh\n[ \"$1\" = auth ] && exit 0\ntrue\n")
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
		w.stub(t, "claude", "#!/bin/sh\n[ \"$1\" = auth ] && exit 0\ntrue\n")
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
		w.stub(t, "claude", "#!/bin/sh\n[ \"$1\" = auth ] && exit 0\ntouch \""+w.bin+"/ran\"\n")
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
		w.stub(t, "claude", "#!/bin/sh\n[ \"$1\" = auth ] && exit 0\ntouch \""+w.bin+"/ran\"\n")
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
		w.stub(t, "claude", "#!/bin/sh\n[ \"$1\" = auth ] && exit 0\ntrue\n")
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
		main := gitT(t, origin, "rev-parse", "main")
		if strings.Join(names, " ") != "acme/.mirror:mirror acme/.trees/"+main+":tree acme/triage:workspace" {
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

func setMaxJobs(t *testing.T, w *jobWorld, n int) {
	t.Helper()
	cfg, _ := loadJobsConfig(w.f.root)
	cfg.MaxJobs = n
	if err := saveJobsConfig(w.f.root, cfg); err != nil {
		t.Fatal(err)
	}
}

func TestReadTrees(t *testing.T) {
	t.Run("a read job runs in its workspace with ./src at the commit, read-only, with its history", func(t *testing.T) {
		origin := originRepo(t)
		w := newJobWorld(t)
		w.stub(t, "claude", `#!/bin/sh
[ "$1" = auth ] && exit 0
pwd > "`+w.bin+`/cwd"
git -C src rev-parse HEAD > "`+w.bin+`/head"
git -C src log --format=%s > "`+w.bin+`/log"
if echo changed > src/README.md 2>/dev/null; then echo wrote > "`+w.bin+`/wrote"; fi
if touch src/new-file 2>/dev/null; then echo wrote > "`+w.bin+`/wrote"; fi
echo note > notes.txt
`)
		src := map[string]any{"mode": "read", "repository": origin, "ref": "feature"}
		rec := w.run("job-1", w.agentSpec(map[string]any{"source": src}))
		if last := rec.last(); last.Status != "done" {
			t.Fatalf("ack = %+v", last)
		}
		feature := gitT(t, origin, "rev-parse", "feature")
		// The terminal ack says which commit was read (#Q4248).
		if last := rec.last(); last.Commit != feature {
			t.Fatalf("the ack's commit is %q, want %s", last.Commit, feature)
		}
		if head, _ := os.ReadFile(filepath.Join(w.bin, "head")); strings.TrimSpace(string(head)) != feature {
			t.Fatalf("./src is at %q, want feature %s", head, feature)
		}
		if log, _ := os.ReadFile(filepath.Join(w.bin, "log")); string(log) != "feature\nfirst\n" {
			t.Fatalf("the tree's history reads %q", log)
		}
		if _, err := os.Stat(filepath.Join(w.bin, "wrote")); err == nil {
			t.Fatal("the agent wrote into the read tree")
		}
		work, _ := filepath.EvalSymlinks(w.work)
		if cwd, _ := os.ReadFile(filepath.Join(w.bin, "cwd")); strings.TrimSpace(string(cwd)) != filepath.Join(work, "acme", "triage") {
			t.Fatalf("the agent ran in %q, want the stable workspace", cwd)
		}
		if target, _ := os.Readlink(filepath.Join(w.work, "acme", "triage", srcLink)); target != filepath.Join(w.work, "acme", treesName, feature) {
			t.Fatalf("./src points at %q", target)
		}
		// The workspace itself stays the agent's to write in.
		if _, err := os.Stat(filepath.Join(w.work, "acme", "triage", "notes.txt")); err != nil {
			t.Fatal("the agent could not write in its workspace")
		}
		if log := w.frames.textOf("job-1", "stderr"); !strings.Contains(log, "./src read-only at "+feature[:12]) {
			t.Fatalf("the log does not say where the code is: %q", log)
		}
	})

	t.Run("two read jobs of a project run at the same time, in one workspace", func(t *testing.T) {
		origin := originRepo(t)
		w := newJobWorld(t)
		setMaxJobs(t, w, 2)
		// Each run waits until both are running, or gives up.
		w.stub(t, "claude", `#!/bin/sh
[ "$1" = auth ] && exit 0
touch "`+w.bin+`/started.$$"
i=0
while [ "$(ls "`+w.bin+`" | grep -c '^started\.')" -lt 2 ]; do
  i=$((i+1)); [ $i -gt 100 ] && exit 3
  sleep 0.1
done
`)
		src := map[string]any{"mode": "read", "repository": origin}
		// A first run makes the mirror and the tree; the two after it meet.
		w.stub(t, "claude-first", "")
		if last := w.run("warm", w.agentSpec(map[string]any{"source": src, "workspace": "other"})); last.last().Status == "" {
			t.Fatal("no ack")
		}
		for _, f := range []string{"started"} {
			matches, _ := filepath.Glob(filepath.Join(w.bin, f+".*"))
			for _, m := range matches {
				_ = os.Remove(m)
			}
		}
		results := make(chan connector.Ack, 2)
		for _, id := range []string{"job-a", "job-b"} {
			go func(id string) {
				results <- w.run(id, w.agentSpec(map[string]any{"source": src, "timeoutSeconds": 600})).last()
			}(id)
		}
		for range 2 {
			if last := <-results; last.Status != "done" {
				t.Fatalf("a concurrent read job ended %+v", last)
			}
		}
	})

	t.Run("a held workspace on another commit refuses the read as busy, and ./src never moves under a run", func(t *testing.T) {
		origin := originRepo(t)
		w := newJobWorld(t)
		setMaxJobs(t, w, 3)
		setFetchTTL(t, w, 0)
		w.stub(t, "claude", "#!/bin/sh\n[ \"$1\" = auth ] && exit 0\nwhile [ ! -f \""+w.bin+"/go\" ]; do sleep 0.05; done\n")
		src := map[string]any{"mode": "read", "repository": origin}
		first := gitT(t, origin, "rev-parse", "main")
		done := make(chan connector.Ack, 1)
		go func() {
			done <- w.run("job-a", w.agentSpec(map[string]any{"source": src, "timeoutSeconds": 600})).last()
		}()
		waitFor(t, func() bool { return strings.Contains(w.frames.textOf("job-a", "stderr"), "agent claude started") })

		commitTo(t, origin, "main", "second.txt")
		busy := w.run("job-b", w.agentSpec(map[string]any{"source": src}))
		if last := busy.last(); last.Status != "failed" || last.Step != stepBusy || !strings.Contains(last.Reason, "waits for it to end") {
			t.Fatalf("ack = %+v, want failed with step busy", last)
		}
		if target, _ := os.Readlink(filepath.Join(w.work, "acme", "triage", srcLink)); filepath.Base(target) != first {
			t.Fatalf("./src moved under a running job to %s", target)
		}
		// Another workspace of the project reads the new commit meanwhile.
		w.stub(t, "go", "")
		if last := w.run("job-c", w.agentSpec(map[string]any{"source": src, "workspace": "review"})).last(); last.Status != "done" {
			t.Fatalf("ack = %+v", last)
		}
		if last := <-done; last.Status != "done" {
			t.Fatalf("ack = %+v", last)
		}
		// Free again: the workspace follows the new commit.
		if last := w.run("job-d", w.agentSpec(map[string]any{"source": src})).last(); last.Status != "done" {
			t.Fatalf("ack = %+v", last)
		}
		if target, _ := os.Readlink(filepath.Join(w.work, "acme", "triage", srcLink)); filepath.Base(target) == first {
			t.Fatal("./src did not follow the new commit once the workspace was free")
		}
	})

	t.Run("a job changing code waits for no reader: it is refused while one holds the workspace", func(t *testing.T) {
		origin := originRepo(t)
		w := newJobWorld(t)
		setMaxJobs(t, w, 2)
		w.stub(t, "claude", "#!/bin/sh\n[ \"$1\" = auth ] && exit 0\nwhile [ ! -f \""+w.bin+"/go\" ]; do sleep 0.05; done\n")
		done := make(chan connector.Ack, 1)
		go func() {
			done <- w.run("job-a", w.agentSpec(map[string]any{"source": map[string]any{"mode": "read", "repository": origin}, "timeoutSeconds": 600})).last()
		}()
		waitFor(t, func() bool { return strings.Contains(w.frames.textOf("job-a", "stderr"), "agent claude started") })
		if last := w.run("job-b", w.agentSpec(nil)).last(); last.Status != "failed" || !strings.Contains(last.Reason, "already runs") {
			t.Fatalf("ack = %+v", last)
		}
		w.stub(t, "go", "")
		<-done
	})

	t.Run("trees nobody reads are removed, and removing the project removes read-only trees", func(t *testing.T) {
		origin := originRepo(t)
		w := newJobWorld(t)
		setFetchTTL(t, w, 0)
		w.stub(t, "claude", "#!/bin/sh\n[ \"$1\" = auth ] && exit 0\ntrue\n")
		src := map[string]any{"mode": "read", "repository": origin}
		first := gitT(t, origin, "rev-parse", "main")
		if last := w.run("job-1", w.agentSpec(map[string]any{"source": src})).last(); last.Status != "done" {
			t.Fatalf("ack = %+v", last)
		}
		second := commitTo(t, origin, "main", "second.txt")
		if last := w.run("job-2", w.agentSpec(map[string]any{"source": src})).last(); last.Status != "done" {
			t.Fatalf("ack = %+v", last)
		}
		trees := filepath.Join(w.work, "acme", treesName)
		if _, err := os.Stat(filepath.Join(trees, first)); !os.IsNotExist(err) {
			t.Fatal("the tree of a commit nobody reads any more is still there")
		}
		if _, err := os.Stat(filepath.Join(trees, second)); err != nil {
			t.Fatal("the tree the workspace reads was removed")
		}
		mirror := filepath.Join(w.work, "acme", mirrorName)
		if list := gitT(t, mirror, "worktree", "list"); strings.Contains(list, first) {
			t.Fatalf("the mirror still lists the removed tree:\n%s", list)
		}

		r := w.acts.jobs.runner
		u, _ := r.jobsUser()
		list, _ := r.workspaces(u)
		var names []string
		for _, ws := range list {
			names = append(names, ws.Name+":"+ws.Kind)
		}
		if strings.Join(names, " ") != ".mirror:mirror .trees/"+second+":tree triage:workspace" {
			t.Fatalf("workspaces = %v", names)
		}

		rm := &ackRecorder{}
		w.acts.Command(context.Background(), connector.Command{ID: "rm-1", Kind: "job-workspace-remove", Project: "acme"}, rm.send)
		if rm.last().Status != "done" {
			t.Fatalf("ack = %+v", rm.last())
		}
		if _, err := os.Stat(filepath.Join(w.work, "acme")); !os.IsNotExist(err) {
			t.Fatal("the project's read-only trees outlived its removal")
		}
	})
}

// agentGit is how a stub agent commits, with an identity of its own.
const agentGit = `git -c user.name=agent -c user.email=agent@example.com`

func writeSpec(w *jobWorld, origin, workspace, branch string) []byte {
	return w.agentSpec(map[string]any{"workspace": workspace,
		"source": map[string]any{"mode": "write", "repository": origin, "branch": branch}})
}

func TestWriteWorktrees(t *testing.T) {
	t.Run("a new branch from the default one, pushed, then removed; a follow-up continues it", func(t *testing.T) {
		origin := originRepo(t)
		w := newJobWorld(t)
		w.stub(t, "claude", `#!/bin/sh
[ "$1" = auth ] && exit 0
set -e
git rev-parse --abbrev-ref HEAD > "`+w.bin+`/branch"
git log -1 --format=%s > "`+w.bin+`/last"
echo work > work-$(date +%s%N).txt
git add -A
`+agentGit+` commit -q -m "agent work"
git push -q 2>"`+w.bin+`/push.err"
`)
		rec := w.run("job-1", writeSpec(w, origin, "q1", "lore/q1"))
		last := rec.last()
		if last.Status != "done" || last.Warning != "" {
			t.Fatalf("ack = %+v", last)
		}
		if b, _ := os.ReadFile(filepath.Join(w.bin, "branch")); strings.TrimSpace(string(b)) != "lore/q1" {
			t.Fatalf("the worktree was on %q", b)
		}
		if l, _ := os.ReadFile(filepath.Join(w.bin, "last")); strings.TrimSpace(string(l)) != "first" {
			t.Fatalf("the new branch started at %q, want main's commit", l)
		}
		if got := gitT(t, origin, "log", "-1", "--format=%s", "lore/q1"); got != "agent work" {
			t.Fatalf("origin's lore/q1 is at %q", got)
		}
		if _, err := os.Stat(filepath.Join(w.work, "acme", "q1")); !os.IsNotExist(err) {
			t.Fatal("a pushed, clean worktree was kept")
		}
		mirror := filepath.Join(w.work, "acme", mirrorName)
		if out, _ := exec.Command("git", "-C", mirror, "rev-parse", "--verify", "--quiet", "refs/heads/lore/q1").Output(); len(out) != 0 {
			t.Fatal("the worktree's local branch outlived it")
		}
		if list := gitT(t, mirror, "worktree", "list"); strings.Contains(list, "q1") {
			t.Fatalf("the mirror still lists the worktree:\n%s", list)
		}
		if log := w.frames.textOf("job-1", "stderr"); !strings.Contains(log, "on new branch lore/q1 from") || !strings.Contains(log, "worktree acme/q1 removed, its work pushed") {
			t.Fatalf("the log: %q", log)
		}

		// A follow-up (a CI fix) finds the pushed branch again.
		if last := w.run("job-2", writeSpec(w, origin, "q1", "lore/q1")).last(); last.Status != "done" || last.Warning != "" {
			t.Fatalf("ack = %+v", last)
		}
		if l, _ := os.ReadFile(filepath.Join(w.bin, "last")); strings.TrimSpace(string(l)) != "agent work" {
			t.Fatalf("the follow-up started at %q, want the pushed branch", l)
		}
		if got := gitT(t, origin, "rev-list", "--count", "lore/q1"); got != "3" {
			t.Fatalf("origin's lore/q1 holds %s commits, want 3", got)
		}
		if log := w.frames.textOf("job-2", "stderr"); !strings.Contains(log, "continuing origin/lore/q1") {
			t.Fatalf("the log: %q", log)
		}
	})

	t.Run("unpushed work is kept, said in the ack's warning, listed kept, and refuses the next job", func(t *testing.T) {
		origin := originRepo(t)
		w := newJobWorld(t)
		w.stub(t, "claude", `#!/bin/sh
[ "$1" = auth ] && exit 0
echo work > work.txt
git add work.txt
`+agentGit+` commit -q -m "not pushed"
exit 1
`)
		last := w.run("job-1", writeSpec(w, origin, "q2", "lore/q2")).last()
		if last.Status != "failed" || last.Warning != "kept acme/q2, 1 unpushed commit(s)" {
			t.Fatalf("ack = %+v", last)
		}
		if _, err := os.Stat(filepath.Join(w.work, "acme", "q2", "work.txt")); err != nil {
			t.Fatal("the kept worktree lost its work")
		}
		r := w.acts.jobs.runner
		u, _ := r.jobsUser()
		list, _ := r.workspaces(u)
		kinds := map[string]string{}
		for _, ws := range list {
			kinds[ws.Name] = ws.Kind
		}
		if kinds["q2"] != workspaceKindKept {
			t.Fatalf("workspaces = %v", kinds)
		}
		next := w.run("job-2", writeSpec(w, origin, "q2", "lore/q2")).last()
		if next.Status != "failed" || !strings.Contains(next.Reason, "kept with work not pushed") {
			t.Fatalf("ack = %+v", next)
		}
		if _, err := os.Stat(filepath.Join(w.work, "acme", "q2", "work.txt")); err != nil {
			t.Fatal("a refused job touched the kept worktree")
		}

		// The quest's completion removes it, and the mirror forgets it.
		rm := &ackRecorder{}
		w.acts.Command(context.Background(), connector.Command{ID: "rm-1", Kind: "job-workspace-remove", Project: "acme", Workspace: "q2"}, rm.send)
		if rm.last().Status != "done" {
			t.Fatalf("ack = %+v", rm.last())
		}
		if list := gitT(t, filepath.Join(w.work, "acme", mirrorName), "worktree", "list"); strings.Contains(list, "q2") {
			t.Fatalf("the mirror still lists the removed worktree:\n%s", list)
		}
		// The local branch it left is not reused: the next job starts from
		// main again, as nothing was pushed.
		w.stub(t, "claude", "#!/bin/sh\n[ \"$1\" = auth ] && exit 0\ngit log -1 --format=%s > \""+w.bin+"/last\"\n")
		if last := w.run("job-3", writeSpec(w, origin, "q2", "lore/q2")).last(); last.Status != "done" {
			t.Fatalf("ack = %+v", last)
		}
		if l, _ := os.ReadFile(filepath.Join(w.bin, "last")); strings.TrimSpace(string(l)) != "first" {
			t.Fatalf("the branch was reused as it stood: %q", l)
		}
	})

	t.Run("uncommitted changes are kept; a clean failed run is removed", func(t *testing.T) {
		origin := originRepo(t)
		w := newJobWorld(t)
		w.stub(t, "claude", "#!/bin/sh\n[ \"$1\" = auth ] && exit 0\necho draft > draft.txt\n")
		if last := w.run("job-1", writeSpec(w, origin, "q3", "lore/q3")).last(); last.Status != "done" || last.Warning != "kept acme/q3, 1 uncommitted change(s)" {
			t.Fatalf("ack = %+v", last)
		}
		w.stub(t, "claude", "#!/bin/sh\n[ \"$1\" = auth ] && exit 0\nexit 2\n")
		last := w.run("job-2", writeSpec(w, origin, "q4", "lore/q4")).last()
		if last.Status != "failed" || last.Warning != "" || last.ExitCode == nil || *last.ExitCode != 2 {
			t.Fatalf("ack = %+v", last)
		}
		if _, err := os.Stat(filepath.Join(w.work, "acme", "q4")); !os.IsNotExist(err) {
			t.Fatal("a clean worktree was kept after a failed run")
		}
	})

	t.Run("a clone from before sources is refused, never run over", func(t *testing.T) {
		origin := originRepo(t)
		w := newJobWorld(t)
		w.stub(t, "claude", "#!/bin/sh\n[ \"$1\" = auth ] && exit 0\ntrue\n")
		old := filepath.Join(w.work, "acme", "q5")
		gitT(t, filepath.Dir(origin), "clone", "--quiet", origin, old)
		last := w.run("job-1", writeSpec(w, origin, "q5", "lore/q5")).last()
		if last.Status != "failed" || !strings.Contains(last.Reason, "from before job sources") {
			t.Fatalf("ack = %+v", last)
		}
	})
}
