package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/alepha-dev/bay/internal/connector"
)

/*
Job workspaces (#Q4218): the durable directories agent jobs run in,
`<jobs base>/<project>/<workspace>`, kept after a run, and beside them the
project's mirror, `<jobs base>/<project>/.mirror` (#Q4245, sources.go). Nothing deletes them on its own, so Bay lists and removes
them: `bay jobs workspaces`, `bay jobs workspace rm <project>[/<name>]`, and
the `job-workspace-remove` command Lore sends when a project is deleted or a
quest's build is done with.

A workspace is held by a lock file under Bay's own root, never under the jobs
user's tree, which that user (and so any agent) can change: one job at a time
runs in a workspace, and a removal waits for no job, it refuses.
*/

// workspaceLocks is where the workspace locks live, under Bay's root.
const workspaceLocks = "job-workspaces"

// lockWorkspace takes a workspace for one job, or says which is in it.
func lockWorkspace(root, project, workspace string) (func(), error) {
	dir := filepath.Join(root, workspaceLocks, project)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	unlock, ok, err := lockFile(filepath.Join(dir, workspace+".lock"))
	if err != nil {
		return nil, fmt.Errorf("could not lock the workspace %s/%s: %w", project, workspace, err)
	}
	if !ok {
		// Busy (#Q4249): a job's ack says so, and Lore queues it again.
		return nil, busyError{fmt.Sprintf("a job already runs in the workspace %s/%s: one at a time", project, workspace)}
	}
	return unlock, nil
}

// jobWorkspace is one workspace as `bay jobs workspaces` lists it, or the
// project's mirror (#Q4245), whose Kind says so.
type jobWorkspace struct {
	Project, Name string
	// Kind is `workspace`, or `mirror` for the project's mirror.
	Kind     string
	Modified time.Time
}

const (
	workspaceKindWorkspace = "workspace"
	workspaceKindMirror    = "mirror"
	// workspaceKindTree is a read tree (#Q4246), `.trees/<commit>`.
	workspaceKindTree = "tree"
	// workspaceKindKept is a write worktree no job runs in (#Q4247): one a
	// job kept because its work was not all pushed. A running one is
	// `worktree`.
	workspaceKindKept     = "kept"
	workspaceKindWorktree = "worktree"
)

// workspaces lists the base's workspaces. A symlink is skipped: the tree is
// the jobs user's, and Bay reads only real directories in it.
func (r *processRunner) workspaces(u *user.User) ([]jobWorkspace, error) {
	base := r.base(u)
	projects, err := os.ReadDir(base)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []jobWorkspace
	for _, p := range projects {
		if !p.IsDir() || !namePattern.MatchString(p.Name()) {
			continue
		}
		names, err := os.ReadDir(filepath.Join(base, p.Name()))
		if err != nil {
			continue
		}
		for _, n := range names {
			if n.Name() == treesName && n.IsDir() {
				trees, _ := os.ReadDir(filepath.Join(base, p.Name(), treesName))
				for _, t := range trees {
					info, err := t.Info()
					if err != nil || !t.IsDir() || !commitPattern.MatchString(t.Name()) {
						continue
					}
					out = append(out, jobWorkspace{Project: p.Name(), Name: treesName + "/" + t.Name(), Kind: workspaceKindTree, Modified: info.ModTime()})
				}
				continue
			}
			// The mirror is listed on purpose: namePattern refuses its
			// leading dot, which is what keeps a workspace from taking it.
			kind := workspaceKindWorkspace
			if n.Name() == mirrorName {
				kind = workspaceKindMirror
			} else if !namePattern.MatchString(n.Name()) {
				continue
			}
			if !n.IsDir() {
				continue
			}
			info, err := n.Info()
			if err != nil {
				continue
			}
			if kind == workspaceKindWorkspace {
				if dotgit, err := os.Lstat(filepath.Join(base, p.Name(), n.Name(), ".git")); err == nil && dotgit.Mode().IsRegular() {
					kind = workspaceKindWorktree
					if unlock, err := lockWorkspace(r.root, p.Name(), n.Name()); err == nil {
						unlock()
						kind = workspaceKindKept
					}
				}
			}
			out = append(out, jobWorkspace{Project: p.Name(), Name: n.Name(), Kind: kind, Modified: info.ModTime()})
		}
	}
	sort.Slice(out, func(i, k int) bool {
		if out[i].Project != out[k].Project {
			return out[i].Project < out[k].Project
		}
		return out[i].Name < out[k].Name
	})
	return out, nil
}

/*
removeWorkspace deletes one workspace, or every workspace of a project when
`workspace` is empty. It holds the lock of each workspace it deletes, so it
refuses while a job runs in one, and it deletes AS THE JOBS USER (`rm -rf`
run as it): the tree is that user's, and root following a link planted there
would delete whatever it names.

A workspace that does not exist is not an error: the answer to "remove it" is
that it is gone.
*/
func (r *processRunner) removeWorkspace(ctx context.Context, project, workspace string) (removed int, err error) {
	if !namePattern.MatchString(project) || (workspace != "" && !namePattern.MatchString(workspace)) {
		return 0, fmt.Errorf("%q is not a workspace this bay names", filepath.Join(project, workspace))
	}
	u, err := r.jobsUser()
	if err != nil {
		return 0, err
	}
	names := []string{workspace}
	if workspace == "" {
		all, err := r.workspaces(u)
		if err != nil {
			return 0, err
		}
		names = names[:0]
		for _, w := range all {
			if w.Project == project && w.Kind != workspaceKindMirror && w.Kind != workspaceKindTree {
				names = append(names, w.Name)
			}
		}
	}
	var unlocks []func()
	defer func() {
		for _, unlock := range unlocks {
			unlock()
		}
	}()
	for _, name := range names {
		unlock, err := lockWorkspace(r.root, project, name)
		if err != nil {
			return 0, err
		}
		unlocks = append(unlocks, unlock)
	}
	if workspace == "" {
		// The whole project goes, its mirror with it: not while a job
		// fetches or makes a worktree from it.
		unlock, err := tryLockMirror(r.root, project)
		if err != nil {
			return 0, err
		}
		unlocks = append(unlocks, unlock)
		_ = os.Remove(mirrorStamp(r.root, project))
	}
	target := filepath.Join(r.base(u), project)
	if workspace != "" {
		target = filepath.Join(target, workspace)
	}
	if _, err := os.Lstat(target); os.IsNotExist(err) {
		return 0, nil
	}
	if workspace == "" {
		// Read trees are not writable (#Q4246), and rm cannot empty a
		// directory it may not write: made writable first, as the jobs user,
		// following no link.
		if err := r.asJobsUser(ctx, u, "chmod", "-R", "--", "u+w", target); err != nil {
			return 0, fmt.Errorf("could not make %s writable to remove it: %w", target, err)
		}
	}
	if err := r.asJobsUser(ctx, u, "rm", "-rf", "--", target); err != nil {
		return 0, fmt.Errorf("could not remove %s: %w", target, err)
	}
	if workspace != "" {
		// The mirror forgets a worktree that was this workspace.
		if unlock, err := tryLockMirror(r.root, project); err == nil {
			if _, err := os.Lstat(r.mirrorDir(u, project)); err == nil {
				_, _ = r.git(ctx, u, r.mirrorDir(u, project), "worktree", "prune")
			}
			unlock()
		}
	}
	return len(names), nil
}

const jobsWorkspacesUsage = "usage: bay jobs workspaces [--root DIR] | bay jobs workspace rm <project>[/<name>] [--root DIR]"

// cmdJobs is `bay jobs workspaces` and `bay jobs workspace rm`.
func cmdJobs(args []string) error {
	root, _ := resolveRoot(args, defaultRoot)
	var rest []string
	for i := 0; i < len(args); i++ {
		if args[i] == "--root" || args[i] == "--control-socket" {
			i++
			continue
		}
		rest = append(rest, args[i])
	}
	r := newProcessRunner(root)
	switch {
	case len(rest) == 1 && rest[0] == "workspaces":
		u, err := r.jobsUser()
		if err != nil {
			return err
		}
		list, err := r.workspaces(u)
		if err != nil {
			return err
		}
		if len(list) == 0 {
			fmt.Printf("no job workspace under %s\n", r.base(u))
			return nil
		}
		for _, w := range list {
			fmt.Printf("%-40s %-9s last changed %s\n", w.Project+"/"+w.Name, w.Kind, w.Modified.UTC().Format(time.RFC3339))
		}
		return nil
	case len(rest) == 3 && rest[0] == "workspace" && rest[1] == "rm":
		project, name, _ := strings.Cut(rest[2], "/")
		n, err := r.removeWorkspace(context.Background(), project, name)
		if err != nil {
			return err
		}
		fmt.Printf("removed %d workspace(s) of %s\n", n, project)
		return nil
	}
	return errors.New(jobsWorkspacesUsage)
}

// jobWorkspaceRemove is the `job-workspace-remove` command: Lore's ask to
// delete a project's workspace, or all of them. Held to no switch: it frees
// disk and touches no app, and a host whose jobs were turned off still holds
// the workspaces its jobs left.
func (a *actions) jobWorkspaceRemove(ctx context.Context, cmd connector.Command) (status, step, reason string) {
	if a.jobs == nil {
		return "failed", "", "this bay process has no job runner"
	}
	if cmd.Project == "" || cmd.App != "" || cmd.Environment != "" {
		return "failed", "", "a job-workspace-remove names a project, and no app or environment"
	}
	n, err := a.jobs.runner.removeWorkspace(ctx, cmd.Project, cmd.Workspace)
	if err != nil {
		return "failed", "", err.Error()
	}
	return "done", "", fmt.Sprintf("removed %d workspace(s)", n)
}
