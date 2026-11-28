package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const testToken = "ghs_0123456789abcdefghijABCDEFGHIJ"

func testGitHub(expires time.Time) map[string]any {
	return map[string]any{
		"token":     testToken,
		"expiresAt": expires.UTC().Format(time.RFC3339),
		"botName":   "lore-acme[bot]",
		"botEmail":  "123456+lore-acme[bot]@users.noreply.github.com",
	}
}

func TestJobGitHubSpec(t *testing.T) {
	w := newJobWorld(t)
	src := map[string]any{"mode": "read", "repository": "https://github.com/acme/app", "ref": "main"}
	parse := func(overrides map[string]any) error {
		_, err := parseJobSpec(w.agentSpec(overrides), w.sink.URL)
		return err
	}
	hour := time.Now().Add(time.Hour)

	t.Run("a job with a source takes a token, its expiry and the bot", func(t *testing.T) {
		if err := parse(map[string]any{"source": src, "github": testGitHub(hour)}); err != nil {
			t.Fatalf("refused: %v", err)
		}
	})
	t.Run("a job with no source takes none", func(t *testing.T) {
		if err := parse(map[string]any{"github": testGitHub(hour)}); err == nil {
			t.Fatal("a token on a job with no code was accepted")
		}
	})
	t.Run("a malformed token or bot is refused", func(t *testing.T) {
		bad := testGitHub(hour)
		bad["token"] = "ghp_personal_token_is_not_this"
		if err := parse(map[string]any{"source": src, "github": bad}); err == nil {
			t.Fatal("a personal token was accepted")
		}
		bad = testGitHub(hour)
		bad["botEmail"] = "someone@example.com"
		if err := parse(map[string]any{"source": src, "github": bad}); err == nil {
			t.Fatal("a bot email elsewhere was accepted")
		}
	})
	t.Run("a check carries none", func(t *testing.T) {
		raw, _ := json.Marshal(map[string]any{"kind": "check", "agent": "claude", "timeoutSeconds": 60, "github": testGitHub(hour)})
		if _, err := parseJobSpec(raw, w.sink.URL); err == nil {
			t.Fatal("a check with a token was accepted")
		}
	})
}

func TestJobCredentials(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}

	t.Run("git reads the job's token through its helper, never the mirror's gh helper", func(t *testing.T) {
		w := newJobWorld(t)
		r := w.acts.jobs.runner
		u, _ := r.jobsUser()
		gh := testGitHub(time.Now().Add(time.Hour))
		var spec jobGitHub
		raw, _ := json.Marshal(gh)
		_ = json.Unmarshal(raw, &spec)
		creds, cleanup, err := r.prepareCredentials(context.Background(), u, "job-1", &spec)
		if err != nil {
			t.Fatal(err)
		}
		// A mirror as Bay configures it, with gh as its helper.
		mirror := t.TempDir()
		gitT(t, mirror, "init", "--bare", "--quiet")
		gitT(t, mirror, "config", "--add", "credential.https://github.com.helper", "")
		gitT(t, mirror, "config", "--add", "credential.https://github.com.helper", "!echo password=from-the-host-login")

		fill := exec.Command("git", "credential", "fill")
		fill.Dir = mirror
		fill.Env = append(os.Environ(), creds.gitEnv()...)
		fill.Stdin = strings.NewReader("protocol=https\nhost=github.com\n\n")
		out, err := fill.Output()
		if err != nil {
			t.Fatalf("git credential fill: %v", err)
		}
		if !strings.Contains(string(out), "password="+testToken) || strings.Contains(string(out), "from-the-host-login") {
			t.Fatalf("git answered %q", out)
		}
		// The mirror's config holds no token.
		if config, _ := os.ReadFile(filepath.Join(mirror, "config")); strings.Contains(string(config), "ghs_") {
			t.Fatal("the mirror's config holds the token")
		}
		// The env names the helper, never the secret.
		if strings.Contains(strings.Join(creds.gitEnv(), " "), testToken) {
			t.Fatal("the token is in the environment")
		}
		info, err := os.Stat(creds.dir)
		if err != nil || info.Mode().Perm() != 0o700 {
			t.Fatalf("the credential directory is %v", info.Mode())
		}
		if info, _ := os.Stat(creds.token); info.Mode().Perm() != 0o600 {
			t.Fatalf("the token file is %v", info.Mode())
		}

		cleanup()
		if _, err := os.Stat(creds.dir); !os.IsNotExist(err) {
			t.Fatal("the credential directory outlived the job")
		}
	})

	t.Run("gh runs through the job's wrapper, with the token and not the host's login", func(t *testing.T) {
		w := newJobWorld(t)
		w.stub(t, "gh", "#!/bin/sh\nprintf '%s' \"${GH_TOKEN:-host-login}\"\n")
		r := w.acts.jobs.runner
		u, _ := r.jobsUser()
		spec := jobGitHub{Token: testToken, ExpiresAt: time.Now().Add(time.Hour).UTC().Format(time.RFC3339), BotName: "lore-acme[bot]", BotEmail: "1+lore-acme[bot]@users.noreply.github.com"}
		creds, cleanup, err := r.prepareCredentials(context.Background(), u, "job-2", &spec)
		if err != nil {
			t.Fatal(err)
		}
		defer cleanup()
		out, _, _, err := r.toolRun(withJobCredentials(context.Background(), creds), u, "gh", []string{"api", "user"}, nil)
		if err != nil || out != testToken {
			t.Fatalf("gh saw %q, %v", out, err)
		}
		// Without the job's credential, gh is the host's.
		out, _, _, _ = r.toolRun(context.Background(), u, "gh", []string{"api", "user"}, nil)
		if out != "host-login" {
			t.Fatalf("gh saw %q", out)
		}
	})

	t.Run("a renewal rewrites the token the helper prints, before expiry", func(t *testing.T) {
		w := newJobWorld(t)
		r := w.acts.jobs.runner
		u, _ := r.jobsUser()
		now := time.Now()
		spec := jobGitHub{Token: testToken, ExpiresAt: now.Add(5 * time.Minute).UTC().Format(time.RFC3339), BotName: "lore-acme[bot]", BotEmail: "1+lore-acme[bot]@users.noreply.github.com"}
		creds, cleanup, err := r.prepareCredentials(context.Background(), u, "job-3", &spec)
		if err != nil {
			t.Fatal(err)
		}
		defer cleanup()
		log, _ := openJobLog(w.f.root, "job-3")
		fresh := "ghs_ZYXWVUTSRQPONMLKJIHGfedcba9876543210"
		var asked atomic.Int32
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan struct{})
		go func() {
			defer close(done)
			creds.keepFresh(ctx, func(context.Context) (jobGitHub, error) {
				asked.Add(1)
				return jobGitHub{Token: fresh, ExpiresAt: now.Add(time.Hour).UTC().Format(time.RFC3339)}, nil
			}, log, time.Now)
		}()
		deadline := time.Now().Add(5 * time.Second)
		for asked.Load() == 0 && time.Now().Before(deadline) {
			time.Sleep(10 * time.Millisecond)
		}
		time.Sleep(50 * time.Millisecond)
		cancel()
		<-done
		if asked.Load() != 1 {
			t.Fatalf("Lore was asked %d times, want once (the new token lasts an hour)", asked.Load())
		}
		if got, _ := os.ReadFile(creds.token); string(got) != fresh {
			t.Fatalf("the token file holds %q", got)
		}
		spooled, _ := os.ReadFile(log.path("stderr"))
		if !strings.Contains(string(spooled), "GitHub token renewed") || strings.Contains(string(spooled), "ghs_") {
			t.Fatal("the log holds a token")
		}
	})
}

func TestJobRunWithGitHubToken(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	t.Setenv("BAY_DEV_JOBS_AS_SELF", "1")
	saved := version
	version = "dev"
	t.Cleanup(func() { version = saved })

	t.Run("the agent's git and gh use the job's token and commit as the bot, on a host with no gh login, and nothing is left", func(t *testing.T) {
		origin := originRepo(t)
		w := newJobWorld(t)
		// gh signed OUT on the host: a job with its token runs anyway.
		w.stub(t, "gh", "#!/bin/sh\n[ \"$1\" = auth ] && exit 1\nprintf '%s' \"${GH_TOKEN:-no-token}\"\n")
		w.stub(t, "claude", `#!/bin/sh
[ "$1" = auth ] && exit 0
gh api user > "`+w.bin+`/gh.out"
printf 'protocol=https\nhost=github.com\n\n' | git credential fill > "`+w.bin+`/fill"
printf '%s' "$GIT_AUTHOR_NAME <$GIT_AUTHOR_EMAIL>" > "`+w.bin+`/author"
`)
		src := map[string]any{"mode": "read", "repository": origin, "ref": "feature"}
		rec := w.run("job-1", w.agentSpec(map[string]any{"source": src, "github": testGitHub(time.Now().Add(time.Hour))}))
		if last := rec.last(); last.Status != "done" {
			t.Fatalf("ack = %+v", last)
		}
		if got, _ := os.ReadFile(filepath.Join(w.bin, "gh.out")); string(got) != testToken {
			t.Fatalf("the agent's gh saw %q", got)
		}
		if got, _ := os.ReadFile(filepath.Join(w.bin, "fill")); !strings.Contains(string(got), "password="+testToken) {
			t.Fatalf("the agent's git answered %q", got)
		}
		if got, _ := os.ReadFile(filepath.Join(w.bin, "author")); string(got) != "lore-acme[bot] <123456+lore-acme[bot]@users.noreply.github.com>" {
			t.Fatalf("commits are authored by %q", got)
		}
		if strings.Contains(w.frames.text("stdout")+w.frames.text("stderr"), "ghs_") {
			t.Fatal("the log holds the token")
		}
		if entries, _ := os.ReadDir(filepath.Join(w.work, ".credentials")); len(entries) != 0 {
			t.Fatalf("the job's credentials outlived it: %v", entries)
		}
		mirror := filepath.Join(w.work, "acme", ".mirror")
		if config, _ := os.ReadFile(filepath.Join(mirror, "config")); strings.Contains(string(config), "ghs_") || strings.Contains(string(config), ".credentials") {
			t.Fatal("the shared mirror's config names the job's credential")
		}
	})

	t.Run("two jobs of one project, one with a token and one on the host's login, never see each other's credential", func(t *testing.T) {
		origin := originRepo(t)
		w := newJobWorld(t)
		w.stub(t, "gh", "#!/bin/sh\n[ \"$1\" = auth ] && exit 0\nprintf '%s' \"${GH_TOKEN:-host-login}\"\n")
		w.stub(t, "claude", `#!/bin/sh
[ "$1" = auth ] && exit 0
gh api user > "`+w.bin+`/gh-$(basename "$PWD")"
printf 'protocol=https\nhost=github.com\n\n' | GIT_TERMINAL_PROMPT=0 git credential fill 2>/dev/null > "`+w.bin+`/fill-$(basename "$PWD")"
# The job on the host's login has no helper here: git cannot ask, and that
# is the point, so the agent still ends well.
exit 0
`)
		src := map[string]any{"mode": "read", "repository": origin, "ref": "feature"}
		with := w.agentSpec(map[string]any{"source": src, "workspace": "with", "github": testGitHub(time.Now().Add(time.Hour))})
		without := w.agentSpec(map[string]any{"source": src, "workspace": "without"})
		done := make(chan string, 2)
		report := func(rec *ackRecorder) string {
			last := rec.last()
			if last.Status == "done" {
				return ""
			}
			return fmt.Sprintf("%+v", last)
		}
		go func() { done <- report(w.run("job-a", with)) }()
		go func() { done <- report(w.run("job-b", without)) }()
		for range 2 {
			if failed := <-done; failed != "" {
				t.Fatalf("a job did not end done: %s\n%s", failed, w.frames.text("stdout")+w.frames.text("stderr"))
			}
		}
		if got, _ := os.ReadFile(filepath.Join(w.bin, "gh-with")); string(got) != testToken {
			t.Fatalf("the job with a token saw gh %q", got)
		}
		if got, _ := os.ReadFile(filepath.Join(w.bin, "gh-without")); string(got) != "host-login" {
			t.Fatalf("the job without one saw gh %q", got)
		}
		if got, _ := os.ReadFile(filepath.Join(w.bin, "fill-without")); strings.Contains(string(got), testToken) {
			t.Fatal("the job on the host's login read the other job's token")
		}
	})
}

func TestJobCredentialWriteFollowsNoLink(t *testing.T) {
	t.Run("a link planted where the temporary file goes is replaced, never written through", func(t *testing.T) {
		dir := t.TempDir()
		victim := filepath.Join(t.TempDir(), "victim")
		if err := os.WriteFile(victim, []byte("untouched"), 0o644); err != nil {
			t.Fatal(err)
		}
		token := filepath.Join(dir, "token")
		if err := os.Symlink(victim, token+".tmp"); err != nil {
			t.Fatal(err)
		}
		creds := &jobCredentials{dir: dir, token: token, uid: os.Getuid(), gid: os.Getgid()}
		if err := creds.write(token, testToken, 0o600); err != nil {
			t.Fatal(err)
		}
		if got, _ := os.ReadFile(victim); string(got) != "untouched" {
			t.Fatalf("the link's target was written: %q", got)
		}
		info, err := os.Lstat(token)
		if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0o600 {
			t.Fatalf("token = %v, %v", info, err)
		}
		if got, _ := os.ReadFile(token); string(got) != testToken {
			t.Fatalf("token holds %q", got)
		}
	})
}
