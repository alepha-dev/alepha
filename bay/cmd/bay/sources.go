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
	"time"
)

/*
Job sources (#E173): what code an agent job finds when it starts, prepared by
Bay before the agent runs, so the agent never clones, fetches or resets.

A spec's `source` is one of:
  - `none`: today's workspace, a directory and nothing in it Bay put there;
  - `read`: the code at `ref`, checked out from the project's mirror and made
    read-only;
  - `write`: a git worktree from the mirror on the job's `branch`.

Read and write need the project's repository on GitHub, reached through the
jobs user's `gh`: a repository URL alone reaches only a public repository.

The mirror is one bare clone per project on the host,
`<jobs base>/<project>/.mirror`. It is NOT a `git clone --mirror`: a mirror
fetch writes and prunes `refs/heads/*`, which would delete the local branch of
a write worktree not pushed yet, and refuses to update a branch a worktree has
checked out. So it fetches remote branches into `refs/remotes/origin/*`, tags
into `refs/tags/*` and pull request heads into `refs/pull/<n>/head`, and
`refs/heads/*` belongs to write worktrees alone.

Every git command runs AS THE JOBS USER, with `gh` as git's credential helper
for github.com, set in the mirror's own config: Bay holds no credential, and a
worktree pushes with the same login. Fetches and every `git worktree` change
on the mirror are serialised by the mirror lock, a file under Bay's root
beside the workspace locks, held for that step only, never for a run.
*/

const (
	sourceNone  = "none"
	sourceRead  = "read"
	sourceWrite = "write"

	// trustPRAuthorWrites asks Bay to check, before the agent starts, that
	// the author of the pull request at `ref` can write to the repository.
	trustPRAuthorWrites = "pr-author-writes"

	// mirrorName is the mirror's directory under a project's jobs directory.
	// A workspace can never take it: namePattern refuses a leading dot.
	mirrorName = ".mirror"

	// defaultFetchTTL is how long a fetch is good for: a burst of read jobs
	// fetches once.
	defaultFetchTTL = 30 * time.Second
	// maxFetchTTL bounds `--fetch-ttl`: past an hour a read is not "latest".
	maxFetchTTL = time.Hour
)

// jobSource is a spec's `source`. Every field lands at once (#Q4245), so the
// wire changes once: a later field would be another rollout, since Bay
// decodes a spec with DisallowUnknownFields.
type jobSource struct {
	// Mode is `none`, `read` or `write`.
	Mode string `json:"mode"`
	// Repository is the project's GitHub repository,
	// `https://github.com/<owner>/<name>`.
	Repository string `json:"repository,omitempty"`
	// Ref is a branch, a tag, a 40-hex commit or `pull/<n>/head`: what a
	// read job reads, and what a write job's new branch starts from. Empty
	// is the repository's default branch.
	Ref string `json:"ref,omitempty"`
	// Branch is a write job's branch: continued when the remote has it,
	// made from Ref otherwise.
	Branch string `json:"branch,omitempty"`
	// Trust is `pr-author-writes` on a job at `pull/<n>/head` whose author
	// must be able to write to the repository.
	Trust string `json:"trust,omitempty"`
}

// mode is the source's mode: a spec without a source is `none`.
func (s *jobSource) mode() string {
	if s == nil || s.Mode == "" {
		return sourceNone
	}
	return s.Mode
}

var (
	// githubRepoPattern is a GitHub repository as Lore sends it.
	githubRepoPattern = regexp.MustCompile(`^https://github\.com/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$`)
	// refNamePattern is the characters a branch or tag name may hold here: a
	// strict subset of what git takes, with no leading dash or dot.
	refNamePattern = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9._/-]{0,199}$`)
	commitPattern  = regexp.MustCompile(`^[0-9a-f]{40}$`)
	pullRefPattern = regexp.MustCompile(`^pull/([1-9][0-9]{0,9})/head$`)
)

// validRefName is a branch or tag name git would take, by the rules of
// `git check-ref-format` this pattern does not already cover.
func validRefName(name string) bool {
	if !refNamePattern.MatchString(name) {
		return false
	}
	for _, bad := range []string{"..", "//", "/.", ".lock/", "@{"} {
		if strings.Contains(name, bad) {
			return false
		}
	}
	return !strings.HasSuffix(name, "/") && !strings.HasSuffix(name, ".") && !strings.HasSuffix(name, ".lock")
}

// validRef is a ref a source may name.
func validRef(ref string) bool {
	return commitPattern.MatchString(ref) || pullRefPattern.MatchString(ref) || validRefName(ref)
}

/*
localRepositoriesAllowed is the end-to-end suite's way in, like devSelf: a
dev build running jobs as itself takes an absolute path to a local repository
in place of a GitHub URL, so Lore's e2e can run a read job without the
network. A released binary refuses it.
*/
func localRepositoriesAllowed() bool {
	return version == "dev" && os.Getenv("BAY_DEV_JOBS_AS_SELF") == "1"
}

func validRepository(repository string) bool {
	if githubRepoPattern.MatchString(repository) {
		name := repository[strings.LastIndex(repository, "/")+1:]
		return name != "." && name != ".." && !strings.Contains(name, "..")
	}
	return localRepositoriesAllowed() && filepath.IsAbs(repository) && filepath.Clean(repository) == repository
}

// validate refuses a source this bay would not prepare.
func (s *jobSource) validate() error {
	if s == nil {
		return nil
	}
	switch s.Mode {
	case sourceNone:
		if s.Repository != "" || s.Ref != "" || s.Branch != "" || s.Trust != "" {
			return errors.New("a none source names no repository, ref, branch or trust")
		}
		return nil
	case sourceRead, sourceWrite:
	default:
		return fmt.Errorf("unknown source mode %q: this bay prepares none, read and write", s.Mode)
	}
	if !validRepository(s.Repository) {
		return fmt.Errorf("%q is not a GitHub repository (https://github.com/<owner>/<name>)", s.Repository)
	}
	if s.Ref != "" && !validRef(s.Ref) {
		return fmt.Errorf("%q is not a branch, a tag, a commit or pull/<n>/head", s.Ref)
	}
	switch {
	case s.Mode == sourceWrite && s.Branch == "":
		return errors.New("a write source names its branch")
	case s.Mode == sourceRead && s.Branch != "":
		return errors.New("a read source names no branch")
	case s.Branch != "" && (!validRefName(s.Branch) || strings.HasPrefix(s.Branch, "pull/")):
		return fmt.Errorf("%q is not a branch name this bay makes", s.Branch)
	}
	if s.Trust != "" {
		if s.Trust != trustPRAuthorWrites {
			return fmt.Errorf("unknown trust %q: this bay checks %s", s.Trust, trustPRAuthorWrites)
		}
		if !pullRefPattern.MatchString(s.Ref) {
			return errors.New("a trust check is for a source at pull/<n>/head")
		}
	}
	return nil
}

// fetchTTL is how long a fetch of the mirror is good for, from the config.
func (c jobsConfig) fetchTTL() time.Duration {
	if c.FetchTTLSeconds == nil {
		return defaultFetchTTL
	}
	return time.Duration(*c.FetchTTLSeconds) * time.Second
}

// parseFetchTTL reads `--fetch-ttl`: a duration (`30s`, `2m`) or seconds.
func parseFetchTTL(raw string) (int, error) {
	d, err := time.ParseDuration(raw)
	if err != nil {
		n, nerr := strconv.Atoi(raw)
		if nerr != nil {
			return 0, fmt.Errorf("--fetch-ttl is a duration (30s, 2m) or a number of seconds")
		}
		d = time.Duration(n) * time.Second
	}
	if d < 0 || d > maxFetchTTL {
		return 0, fmt.Errorf("--fetch-ttl is from 0 to %s", maxFetchTTL)
	}
	return int(d / time.Second), nil
}

// ---------------------------------------------------------------------------
// The mirror.
// ---------------------------------------------------------------------------

// mirrorDir is a project's mirror.
func (r *processRunner) mirrorDir(u *user.User, project string) string {
	return filepath.Join(r.base(u), project, mirrorName)
}

// mirrorStamp is the file whose time is the mirror's last fetch, under Bay's
// root: the jobs user's tree is not where Bay keeps what it trusts.
func mirrorStamp(root, project string) string {
	return filepath.Join(root, workspaceLocks, project, mirrorName+".fetched")
}

/*
lockMirror takes a project's mirror lock, waiting for it: a fetch or a
`git worktree` change is seconds, and a job that finds another job's fetch in
progress waits for it rather than failing. The wait ends with ctx.
*/
func lockMirror(ctx context.Context, root, project string) (func(), error) {
	dir := filepath.Join(root, workspaceLocks, project)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, mirrorName+".lock")
	for {
		unlock, ok, err := lockFile(path)
		if err != nil {
			return nil, fmt.Errorf("could not lock the mirror of %s: %w", project, err)
		}
		if ok {
			return unlock, nil
		}
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("the mirror of %s stayed locked by another job: %w", project, context.Cause(ctx))
		case <-time.After(100 * time.Millisecond):
		}
	}
}

// tryLockMirror takes the mirror lock or says it is held, without waiting:
// what a removal does, which refuses rather than waits.
func tryLockMirror(root, project string) (func(), error) {
	dir := filepath.Join(root, workspaceLocks, project)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	unlock, ok, err := lockFile(filepath.Join(dir, mirrorName+".lock"))
	if err != nil {
		return nil, fmt.Errorf("could not lock the mirror of %s: %w", project, err)
	}
	if !ok {
		return nil, fmt.Errorf("a job is updating the mirror of %s: try again in a moment", project)
	}
	return unlock, nil
}

/*
git runs one git command as the jobs user in dir, and answers its stdout,
trimmed. A failure answers git's own message, which is what a job's reason
says: "could not read Username" tells the operator more than a status.
*/
func (r *processRunner) git(ctx context.Context, u *user.User, dir string, args ...string) (string, error) {
	bin, err := r.lookPath(u.HomeDir, "git")
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	cmd, err := r.command(ctx, u, dir, bin, args, r.jobEnv(u))
	if err != nil {
		return "", err
	}
	var stdout, stderr strings.Builder
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	code, err := r.wait(ctx, cmd)
	if err != nil {
		return "", fmt.Errorf("git %s: %w", args[0], err)
	}
	if code != nil && *code != 0 {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = fmt.Sprintf("exited with status %d", *code)
		}
		return "", fmt.Errorf("git %s: %s", args[0], cut(msg, 600))
	}
	return strings.TrimSpace(stdout.String()), nil
}

// mirrorRefspecs are what the mirror fetches: never `refs/heads/*`.
var mirrorRefspecs = []string{
	"+refs/heads/*:refs/remotes/origin/*",
	"+refs/tags/*:refs/tags/*",
	"+refs/pull/*/head:refs/pull/*/head",
}

/*
configureMirror sets the mirror's remote, its refspecs and `gh` as its
credential helper for github.com. Run on the first clone, and again when the
project's repository changed.
*/
func (r *processRunner) configureMirror(ctx context.Context, u *user.User, dir, repository string) error {
	steps := [][]string{
		{"config", "remote.origin.url", repository},
		{"config", "--unset-all", "remote.origin.fetch"},
	}
	for _, spec := range mirrorRefspecs {
		steps = append(steps, []string{"config", "--add", "remote.origin.fetch", spec})
	}
	steps = append(steps,
		// An empty helper first clears any helper of the jobs user's global
		// config for github.com; then gh answers.
		[]string{"config", "--unset-all", "credential.https://github.com.helper"},
		[]string{"config", "--add", "credential.https://github.com.helper", ""},
		[]string{"config", "--add", "credential.https://github.com.helper", "!gh auth git-credential"},
	)
	for _, args := range steps {
		if _, err := r.git(ctx, u, dir, args...); err != nil {
			// `--unset-all` of a key not set is git's status 5: nothing to do.
			if args[1] == "--unset-all" {
				continue
			}
			return err
		}
	}
	return nil
}

/*
syncMirror makes a project's mirror exist and current, under the mirror lock:
a bare clone on first use, a fetch after, skipped when the last one is younger
than the fetch TTL unless `force` is set. It answers whether it fetched.

The log says which happened, timestamped; a failed fetch is an error with
git's own message, and the job fails before its agent starts.
*/
func (r *processRunner) syncMirror(ctx context.Context, u *user.User, project, repository string, force bool, log *jobLog) error {
	cfg, err := loadJobsConfig(r.root)
	if err != nil {
		return fmt.Errorf("the jobs config is unreadable: %w", err)
	}
	unlock, err := lockMirror(ctx, r.root, project)
	if err != nil {
		return err
	}
	defer unlock()
	dir := r.mirrorDir(u, project)
	stamp := mirrorStamp(r.root, project)

	if _, err := os.Lstat(filepath.Join(dir, "HEAD")); err != nil {
		if err := r.asJobsUser(ctx, u, "mkdir", "-p", "-m", "700", "--", filepath.Dir(dir)); err != nil {
			return fmt.Errorf("could not create the jobs directory of %s: %w", project, err)
		}
		if _, err := r.git(ctx, u, u.HomeDir, "init", "--bare", "--quiet", dir); err != nil {
			return fmt.Errorf("could not create the mirror of %s: %w", project, err)
		}
		if err := r.configureMirror(ctx, u, dir, repository); err != nil {
			return fmt.Errorf("could not configure the mirror of %s: %w", project, err)
		}
		_ = os.Remove(stamp)
		force = true
	} else if url, _ := r.git(ctx, u, dir, "config", "--local", "--get", "remote.origin.url"); url != repository {
		// The project's repository changed: the mirror follows it.
		if err := r.configureMirror(ctx, u, dir, repository); err != nil {
			return fmt.Errorf("could not configure the mirror of %s: %w", project, err)
		}
		force = true
	}

	if !force {
		if info, err := os.Stat(stamp); err == nil {
			if age := time.Since(info.ModTime()); age < cfg.fetchTTL() {
				log.Step(fmt.Sprintf("mirror fresh, fetched %s ago", age.Round(time.Second)))
				return nil
			}
		}
	}
	started := time.Now()
	if _, err := r.git(ctx, u, dir, "fetch", "--prune", "--quiet", "origin"); err != nil {
		return fmt.Errorf("could not fetch %s: %w", repository, err)
	}
	// origin/HEAD is the default branch a read with no ref follows: asked of
	// the remote on every real fetch, since a default branch can change.
	if _, err := r.git(ctx, u, dir, "remote", "set-head", "origin", "--auto"); err != nil {
		log.Note("could not read the repository's default branch: " + err.Error())
	}
	if err := touch(stamp); err != nil {
		return err
	}
	head, _ := r.git(ctx, u, dir, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/HEAD^{commit}")
	log.Step(fmt.Sprintf("mirror fetched %s in %d ms", shortSHA(head), time.Since(started).Milliseconds()))
	return nil
}

// touch makes path exist with the current time.
func touch(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	now := time.Now()
	if err := os.Chtimes(path, now, now); err == nil {
		return nil
	}
	return os.WriteFile(path, nil, 0o600)
}

func shortSHA(sha string) string {
	if len(sha) > 12 {
		return sha[:12]
	}
	if sha == "" {
		return "(no default branch)"
	}
	return sha
}

/*
resolveRef answers the commit a source's ref names in the mirror: the default
branch (`origin/HEAD`) for none, then a commit, a pull request's head, a
remote branch, a tag, in that order.
*/
func (r *processRunner) resolveRef(ctx context.Context, u *user.User, dir, ref string) (string, error) {
	var candidates []string
	switch {
	case ref == "":
		candidates = []string{"refs/remotes/origin/HEAD"}
	case commitPattern.MatchString(ref):
		candidates = []string{ref}
	case pullRefPattern.MatchString(ref):
		candidates = []string{"refs/" + ref}
	default:
		candidates = []string{"refs/remotes/origin/" + ref, "refs/tags/" + ref}
	}
	for _, c := range candidates {
		if sha, err := r.git(ctx, u, dir, "rev-parse", "--verify", "--quiet", c+"^{commit}"); err == nil && commitPattern.MatchString(sha) {
			return sha, nil
		}
	}
	if ref == "" {
		return "", errors.New("the repository's default branch is unknown: its mirror has no origin/HEAD")
	}
	return "", fmt.Errorf("%q is no branch, tag, commit or pull request head of the repository", ref)
}

/*
preparedSource is what Bay prepared for a job: the commit it resolved, and
where the agent runs.
*/
type preparedSource struct {
	Commit string
}

/*
prepareMirror brings the mirror up to date for a source and resolves its ref.
A ref the mirror does not know after a skipped fetch fetches once more: a
commit pushed in the last seconds is not a reason to fail.
*/
func (r *processRunner) prepareMirror(ctx context.Context, u *user.User, project string, src *jobSource, log *jobLog) (string, error) {
	if err := r.syncMirror(ctx, u, project, src.Repository, false, log); err != nil {
		return "", err
	}
	dir := r.mirrorDir(u, project)
	sha, err := r.resolveRef(ctx, u, dir, src.Ref)
	if err != nil {
		if ferr := r.syncMirror(ctx, u, project, src.Repository, true, log); ferr != nil {
			return "", ferr
		}
		if sha, err = r.resolveRef(ctx, u, dir, src.Ref); err != nil {
			return "", err
		}
	}
	ref := src.Ref
	if ref == "" {
		ref = "the default branch"
	}
	log.Step(fmt.Sprintf("%s is %s", ref, sha))
	return sha, nil
}

/*
prepareWorkspace prepares an agent job's directory before its agent starts,
and answers it with what releases its holds. A read job is prepareRead; a
`none` job holds its workspace alone, as before sources; a write job also
fetches the mirror and resolves its ref.
*/
func (r *processRunner) prepareWorkspace(ctx context.Context, u *user.User, spec jobSpec, log *jobLog) (string, preparedSource, func(), error) {
	if spec.Source.mode() == sourceRead {
		return r.prepareRead(ctx, u, spec, log)
	}
	unlock, err := lockWorkspace(r.root, spec.Project, spec.Workspace)
	if err != nil {
		return "", preparedSource{}, nil, err
	}
	dir, err := r.workspaceDir(ctx, u, spec.Project, spec.Workspace)
	if err != nil {
		unlock()
		return "", preparedSource{}, nil, err
	}
	log.Step("workspace " + spec.Project + "/" + spec.Workspace + " ready")
	if spec.Source.mode() == sourceNone {
		return dir, preparedSource{}, unlock, nil
	}
	sha, err := r.prepareMirror(ctx, u, spec.Project, spec.Source, log)
	if err != nil {
		unlock()
		return "", preparedSource{}, nil, err
	}
	return dir, preparedSource{Commit: sha}, unlock, nil
}

// ---------------------------------------------------------------------------
// Read trees (#Q4246).
// ---------------------------------------------------------------------------

// treesName is the directory a project's read trees live in, one per commit.
// Its leading dot keeps a workspace from taking it, like the mirror's.
const treesName = ".trees"

// srcLink is the link in a read job's workspace that reaches its tree.
const srcLink = "src"

/*
busyError is a job this bay cannot start YET, as opposed to one it refuses:
its slots are full, its workspace is held, or its workspace reads another
commit while a run holds it. The job's ack says `failed` with step `busy`
(#Q4249), and Lore queues it again when a job of this host ends.
*/
type busyError struct{ msg string }

func (e busyError) Error() string { return e.msg }

// stepBusy is the step of a busy job's failed ack.
const stepBusy = "busy"

func (r *processRunner) treesDir(u *user.User, project string) string {
	return filepath.Join(r.base(u), project, treesName)
}

// treeHoldPath is the lock a read job holds on its tree, shared with the
// other readers of that commit, under Bay's root.
func treeHoldPath(root, project, sha string) string {
	return filepath.Join(root, workspaceLocks, project, treesName, sha+".lock")
}

/*
ensureTree makes the read tree of a commit once, under the mirror lock: a
detached `git worktree` of the mirror, made BY THE JOBS USER and then made
read-only by it (`chmod -R a-w`). Not owned by Bay's user: Bay does no
filesystem work as root in the jobs user's tree, and git refuses to work in a
repository another user owns. The jobs user can undo the chmod: it is a guard
against a run changing code other runs read, not a boundary.

It answers with the tree's hold taken, before the mirror lock is released, so
the clean-up of another job never removes a tree between its making and its
first reader.
*/
func (r *processRunner) ensureTree(ctx context.Context, u *user.User, project, sha string) (string, func(), error) {
	unlock, err := lockMirror(ctx, r.root, project)
	if err != nil {
		return "", nil, err
	}
	defer unlock()
	tree := filepath.Join(r.treesDir(u, project), sha)
	if head, err := r.git(ctx, u, tree, "rev-parse", "HEAD"); err != nil || head != sha {
		// Missing, or left half made by a run that died: made again.
		if _, err := os.Lstat(tree); err == nil {
			if err := r.removeTree(ctx, u, project, tree); err != nil {
				return "", nil, err
			}
		}
		if err := r.asJobsUser(ctx, u, "mkdir", "-p", "-m", "700", "--", r.treesDir(u, project)); err != nil {
			return "", nil, fmt.Errorf("could not create the read trees of %s: %w", project, err)
		}
		if _, err := r.git(ctx, u, r.mirrorDir(u, project), "worktree", "add", "--detach", "--quiet", tree, sha); err != nil {
			return "", nil, fmt.Errorf("could not check out %s: %w", sha, err)
		}
		if err := r.asJobsUser(ctx, u, "chmod", "-R", "--", "a-w", tree); err != nil {
			return "", nil, fmt.Errorf("could not make the tree of %s read-only: %w", sha, err)
		}
	}
	holdDir := filepath.Dir(treeHoldPath(r.root, project, sha))
	if err := os.MkdirAll(holdDir, 0o700); err != nil {
		return "", nil, err
	}
	release, _, ok, err := lockFileForRead(treeHoldPath(r.root, project, sha), nil)
	if err != nil {
		return "", nil, err
	}
	if !ok {
		// Only a clean-up holds a tree's lock exclusively, and it holds the
		// mirror lock too, which this job has: it cannot happen.
		return "", nil, busyError{fmt.Sprintf("the tree of %s is being removed", sha)}
	}
	return tree, release, nil
}

/*
removeTree removes one read tree, the caller holding the mirror lock: as the
jobs user, the tree made writable again (`chmod -R u+w`, which follows no
link), then `git worktree remove --force`, and a prune for what that leaves.
*/
func (r *processRunner) removeTree(ctx context.Context, u *user.User, project, tree string) error {
	if err := r.asJobsUser(ctx, u, "chmod", "-R", "--", "u+w", tree); err != nil {
		return fmt.Errorf("could not make %s writable to remove it: %w", tree, err)
	}
	mirror := r.mirrorDir(u, project)
	if _, err := r.git(ctx, u, mirror, "worktree", "remove", "--force", tree); err != nil {
		// Not a worktree git knows: a directory, removed as one.
		if err := r.asJobsUser(ctx, u, "rm", "-rf", "--", tree); err != nil {
			return err
		}
	}
	_, _ = r.git(ctx, u, mirror, "worktree", "prune")
	return nil
}

/*
holdRead takes a read job's workspace: a shared hold, so any number of read
jobs run in it together, refused by a write job's exclusive one. `./src` is
pointed at the job's tree only when no run holds the workspace: a link never
moves under a running job. A read job that resolves to another commit than the
one a held workspace reads is busy, and goes back to Lore's queue; with the
fetch TTL a burst of jobs resolves to one commit, so this is rare.
*/
func (r *processRunner) holdRead(ctx context.Context, u *user.User, project, workspace, dir, tree string) (func(), error) {
	locks := filepath.Join(r.root, workspaceLocks, project)
	if err := os.MkdirAll(locks, 0o700); err != nil {
		return nil, err
	}
	link := filepath.Join(dir, srcLink)
	points := func() bool {
		target, err := os.Readlink(link)
		return err == nil && target == tree
	}
	release, _, ok, err := lockFileForRead(filepath.Join(locks, workspace+".lock"), func() error {
		if points() {
			return nil
		}
		// `ln -sfn` as the jobs user: the link is that user's, and replacing
		// it never follows what it pointed at.
		if err := r.asJobsUser(ctx, u, "ln", "-sfn", "--", tree, link); err != nil {
			return fmt.Errorf("could not point %s/%s/src at its tree: %w", project, workspace, err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, busyError{fmt.Sprintf("a job changing code runs in the workspace %s/%s: this read waits for it", project, workspace)}
	}
	if !points() {
		release()
		target, _ := os.Readlink(link)
		return nil, busyError{fmt.Sprintf("the workspace %s/%s reads %s for a running job: this read of %s waits for it to end",
			project, workspace, shortSHA(filepath.Base(target)), shortSHA(filepath.Base(tree)))}
	}
	return release, nil
}

/*
prepareRead prepares a read job: the mirror fetched, its ref resolved, the
commit's tree made once and held, and the workspace held with `./src` on it.
The run's directory stays `<jobs base>/<project>/<workspace>`, so an agent CLI
that keeps its sessions by directory can resume there.
*/
func (r *processRunner) prepareRead(ctx context.Context, u *user.User, spec jobSpec, log *jobLog) (string, preparedSource, func(), error) {
	dir, err := r.workspaceDir(ctx, u, spec.Project, spec.Workspace)
	if err != nil {
		return "", preparedSource{}, nil, err
	}
	sha, err := r.prepareMirror(ctx, u, spec.Project, spec.Source, log)
	if err != nil {
		return "", preparedSource{}, nil, err
	}
	tree, releaseTree, err := r.ensureTree(ctx, u, spec.Project, sha)
	if err != nil {
		return "", preparedSource{}, nil, err
	}
	releaseWorkspace, err := r.holdRead(ctx, u, spec.Project, spec.Workspace, dir, tree)
	if err != nil {
		releaseTree()
		return "", preparedSource{}, nil, err
	}
	log.Step(fmt.Sprintf("workspace %s/%s ready, ./src read-only at %s", spec.Project, spec.Workspace, shortSHA(sha)))
	release := func() {
		releaseWorkspace()
		releaseTree()
	}
	return dir, preparedSource{Commit: sha}, release, nil
}

/*
cleanTrees removes the project's read trees no run holds and no workspace's
`./src` points at: what the next read job of a project does once it ended.
A tree a workspace points at is the newest that workspace read, kept for its
next run; the others are commits nobody reads any more.
*/
func (r *processRunner) cleanTrees(ctx context.Context, u *user.User, project string) {
	trees, err := os.ReadDir(r.treesDir(u, project))
	if err != nil {
		return
	}
	pointed := map[string]bool{}
	if entries, err := os.ReadDir(filepath.Join(r.base(u), project)); err == nil {
		for _, e := range entries {
			if target, err := os.Readlink(filepath.Join(r.base(u), project, e.Name(), srcLink)); err == nil {
				pointed[filepath.Base(target)] = true
			}
		}
	}
	unlock, err := tryLockMirror(r.root, project)
	if err != nil {
		return
	}
	defer unlock()
	for _, t := range trees {
		sha := t.Name()
		if !commitPattern.MatchString(sha) || pointed[sha] {
			continue
		}
		release, ok, err := lockFile(treeHoldPath(r.root, project, sha))
		if err != nil || !ok {
			continue
		}
		_ = r.removeTree(ctx, u, project, filepath.Join(r.treesDir(u, project), sha))
		release()
		_ = os.Remove(treeHoldPath(r.root, project, sha))
	}
}
