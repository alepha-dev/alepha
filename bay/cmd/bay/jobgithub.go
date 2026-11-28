package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

/*
A job's GitHub credential (#Q4361, epic #E177): an installation token Lore
minted for the job's repository when the host pulled the spec, its expiry,
and the identity its commits carry (the App's bot). Absent, the job runs as
before, on the jobs user's own `gh` login.

When present:

  - Bay's own git calls for the job (mirror fetch, read tree, worktree, push)
    and its `gh` calls (checkPullRequest) take the credential per call: the
    context carries it, `git` reads the job's helper through GIT_CONFIG_*
    and `gh` runs through the job's wrapper. Nothing comes from the host's
    login.
  - The agent's `git` and `gh` read it from a job-private directory Bay
    creates and removes with the job (0700, the jobs user's): a token file
    Bay rewrites on renewal, a credential helper that prints it, and a `gh`
    wrapper first on the job's PATH. The helper reaches git through the job
    process's environment only (an empty helper first, which resets the
    mirror's `gh` helper, then the job's), so it applies to that process tree
    and never to another job sharing the mirror.
  - The shared mirror's config holds no credential, and nothing is keyed on
    the mirror lock, which is not held during a run.
  - Commits carry the bot identity, through GIT_AUTHOR_* / GIT_COMMITTER_*.
  - The token lasts an hour and a job may run twelve: at ten minutes left,
    Bay asks Lore for a fresh one and rewrites the token file.
  - The token is in no log, no workspace file, no git config, no command
    line: `-c` and GIT_CONFIG_* name the helper, never the secret.
*/
type jobGitHub struct {
	Token     string `json:"token"`
	ExpiresAt string `json:"expiresAt"`
	BotName   string `json:"botName"`
	BotEmail  string `json:"botEmail"`
}

var (
	// githubTokenPattern is an installation token as GitHub mints it.
	githubTokenPattern = regexp.MustCompile(`^ghs_[A-Za-z0-9_]{20,255}$`)
	// botNamePattern is `<slug>[bot]`.
	botNamePattern  = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}\[bot\]$`)
	botEmailPattern = regexp.MustCompile(`^[0-9]{0,20}\+?[a-z0-9][a-z0-9-]{0,62}\[bot\]@users\.noreply\.github\.com$`)
)

func (g *jobGitHub) validate() error {
	if g == nil {
		return nil
	}
	if !githubTokenPattern.MatchString(g.Token) {
		return errors.New("the GitHub token is not an installation token")
	}
	if _, err := time.Parse(time.RFC3339, g.ExpiresAt); err != nil {
		return errors.New("the GitHub token's expiry is not a time")
	}
	if !botNamePattern.MatchString(g.BotName) || !botEmailPattern.MatchString(g.BotEmail) {
		return errors.New("the GitHub bot identity is not an App's bot")
	}
	return nil
}

func (g *jobGitHub) expires() time.Time {
	at, _ := time.Parse(time.RFC3339, g.ExpiresAt)
	return at
}

// jobCredentials is a job's private credential directory.
type jobCredentials struct {
	dir     string
	token   string // the token file's path
	helper  string // the credential helper's path
	ghBin   string // the gh wrapper's directory, first on the job's PATH
	gh      string // the gh wrapper, empty when the jobs user has no gh
	uid     int
	gid     int
	bot     jobGitHub
	mu      sync.Mutex
	expires time.Time
}

// renewMargin is how long before its expiry a job's token is renewed.
const renewMargin = 10 * time.Minute

type jobCredentialsKey struct{}

type tokenRenewerKey struct{}

// withTokenRenewer carries how a job's token is renewed: asked of Lore.
func withTokenRenewer(ctx context.Context, renew func(context.Context) (jobGitHub, error)) context.Context {
	return context.WithValue(ctx, tokenRenewerKey{}, renew)
}

func tokenRenewerOf(ctx context.Context) func(context.Context) (jobGitHub, error) {
	renew, _ := ctx.Value(tokenRenewerKey{}).(func(context.Context) (jobGitHub, error))
	return renew
}

// withJobCredentials carries a job's credential to every git and gh call
// Bay makes for it.
func withJobCredentials(ctx context.Context, creds *jobCredentials) context.Context {
	if creds == nil {
		return ctx
	}
	return context.WithValue(ctx, jobCredentialsKey{}, creds)
}

func jobCredentialsOf(ctx context.Context) *jobCredentials {
	creds, _ := ctx.Value(jobCredentialsKey{}).(*jobCredentials)
	return creds
}

// credentialsDir is where jobs keep their credentials: under the jobs base,
// never in a workspace an agent reads or a mirror it shares.
func (r *processRunner) credentialsDir(u *user.User, id string) string {
	return filepath.Join(r.base(u), ".credentials", id)
}

/*
prepareCredentials writes a job's private directory: the token, the helper
that prints it, and the gh wrapper. Owned by the jobs user, 0700, and
removed by the cleanup it answers, whatever the job's end.

Everything under the jobs base is that user's to change, so Bay never
creates, chowns or removes a directory there as root: the jobs user makes
and removes them (`mkdir`, `rm` run as it), as workspaceDir does. Bay
writes each file itself, through an exclusive, no-follow open, and sets its
mode and owner on the open file, so a symlink planted in the directory
gives root nothing to follow.
*/
func (r *processRunner) prepareCredentials(ctx context.Context, u *user.User, id string, gh *jobGitHub) (*jobCredentials, func(), error) {
	if gh == nil {
		return nil, func() {}, nil
	}
	uid, _ := strconv.Atoi(u.Uid)
	gid, _ := strconv.Atoi(u.Gid)
	dir := r.credentialsDir(u, id)
	creds := &jobCredentials{
		dir:     dir,
		token:   filepath.Join(dir, "token"),
		helper:  filepath.Join(dir, "git-credential-lore"),
		ghBin:   filepath.Join(dir, "bin"),
		uid:     uid,
		gid:     gid,
		bot:     *gh,
		expires: gh.expires(),
	}
	cleanup := func() {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), time.Minute)
		defer cancel()
		_ = r.asJobsUser(ctx, u, "rm", "-rf", "--", dir)
	}
	if err := r.asJobsUser(ctx, u, "mkdir", "-p", "-m", "700", "--", filepath.Dir(dir), dir, creds.ghBin); err != nil {
		return nil, cleanup, fmt.Errorf("could not make the job's credential directory: %w", err)
	}
	if err := creds.write(creds.token, gh.Token, 0o600); err != nil {
		cleanup()
		return nil, cleanup, err
	}
	helper := "#!/bin/sh\n# A job's git credential helper (Bay): prints the job's GitHub token.\n" +
		"[ \"$1\" = get ] || exit 0\n" +
		"printf 'username=x-access-token\\npassword=%s\\n' \"$(cat " + shellQuote(creds.token) + ")\"\n"
	if err := creds.write(creds.helper, helper, 0o700); err != nil {
		cleanup()
		return nil, cleanup, err
	}
	if real, err := r.lookPath(u.HomeDir, "gh"); err == nil {
		creds.gh = filepath.Join(creds.ghBin, "gh")
		wrapper := "#!/bin/sh\n# A job's gh (Bay): the job's GitHub token, never the host's login.\n" +
			"GH_TOKEN=\"$(cat " + shellQuote(creds.token) + ")\" GH_PROMPT_DISABLED=1 exec " + shellQuote(real) + " \"$@\"\n"
		if err := creds.write(creds.gh, wrapper, 0o700); err != nil {
			cleanup()
			return nil, cleanup, err
		}
	}
	return creds, cleanup, nil
}

/*
gitEnv is what makes git use the job's helper for github.com: an empty
helper first, which resets every helper a config file set (the mirror's
`gh`, the jobs user's global one), then the job's. Paths only.
*/
func (c *jobCredentials) gitEnv() []string {
	key := "credential.https://github.com.helper"
	return []string{
		"GIT_CONFIG_COUNT=2",
		"GIT_CONFIG_KEY_0=" + key,
		"GIT_CONFIG_VALUE_0=",
		"GIT_CONFIG_KEY_1=" + key,
		"GIT_CONFIG_VALUE_1=" + c.helper,
	}
}

// agentEnv is the agent process's: git's helper, the gh wrapper first on
// PATH, and the bot as author and committer.
func (c *jobCredentials) agentEnv(path []string) []string {
	env := append(c.gitEnv(),
		"GIT_AUTHOR_NAME="+c.bot.BotName,
		"GIT_AUTHOR_EMAIL="+c.bot.BotEmail,
		"GIT_COMMITTER_NAME="+c.bot.BotName,
		"GIT_COMMITTER_EMAIL="+c.bot.BotEmail,
		"GH_PROMPT_DISABLED=1",
	)
	if c.gh != "" {
		env = append(env, "PATH="+strings.Join(append([]string{c.ghBin}, path...), ":"))
	}
	return env
}

/*
renew rewrites the token file with a fresh token, atomically: a git or gh
reading it meanwhile reads the old one or the new one, never half.
*/
func (c *jobCredentials) renew(gh jobGitHub) error {
	if !githubTokenPattern.MatchString(gh.Token) {
		return errors.New("the renewed GitHub token is not an installation token")
	}
	at, err := time.Parse(time.RFC3339, gh.ExpiresAt)
	if err != nil {
		return errors.New("the renewed GitHub token's expiry is not a time")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.write(c.token, gh.Token, 0o600); err != nil {
		return err
	}
	c.expires = at
	return nil
}

func (c *jobCredentials) expiry() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.expires
}

/*
keepFresh renews the token at ten minutes before its expiry, for as long as
the job runs: asked of Lore over the bay's connection. A failed renewal is
said in the job's log (never the token) and tried again a minute later; the
job keeps the token it has until then.
*/
func (c *jobCredentials) keepFresh(ctx context.Context, renew func(context.Context) (jobGitHub, error), log *jobLog, now func() time.Time) {
	if renew == nil {
		return
	}
	renewed := false
	for {
		wait := c.expiry().Add(-renewMargin).Sub(now())
		if wait < 0 {
			wait = 0
		}
		// A renewed token already inside the margin (a clock apart from
		// Lore's) is asked again a minute later, never at once.
		if renewed && wait < time.Minute {
			wait = time.Minute
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		gh, err := renew(ctx)
		if err == nil {
			err = c.renew(gh)
		}
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Note("could not renew the job's GitHub token: " + cut(err.Error(), 300))
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Minute):
			}
			continue
		}
		renewed = true
		log.Step("GitHub token renewed")
	}
}

/*
write writes a file as the jobs user's, through a temporary name: created
exclusively and without following a link, its mode and owner set on the
open file, then renamed over the old one. A name planted where the
temporary goes is removed first, never written through.
*/
func (c *jobCredentials) write(path, content string, mode os.FileMode) error {
	tmp := path + ".tmp"
	_ = os.Remove(tmp)
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL|syscall.O_NOFOLLOW, 0o600)
	if err != nil {
		return fmt.Errorf("could not write the job's credential: %w", err)
	}
	fail := func(err error) error {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if _, err := f.WriteString(content); err != nil {
		return fail(fmt.Errorf("could not write the job's credential: %w", err))
	}
	if err := f.Chmod(mode); err != nil {
		return fail(fmt.Errorf("could not protect the job's credential: %w", err))
	}
	if os.Geteuid() == 0 {
		if err := f.Chown(c.uid, c.gid); err != nil {
			return fail(fmt.Errorf("could not give the job's credential to the jobs user: %w", err))
		}
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("could not write the job's credential: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("could not write the job's credential: %w", err)
	}
	return nil
}

// shellQuote quotes a path for /bin/sh.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
