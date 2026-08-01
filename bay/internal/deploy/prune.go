package deploy

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

/*
Prune deletes all but the `keep` most recent releases of an app instance.

Releases accumulate on every deploy and nothing removed them: on a host with
twenty apps that is the disk filling up, and a full disk does not take down the
app that was being deployed — it takes down every app, plus the backups and
Bay's own state writes. It is the one failure here whose blast radius is the
whole machine.

Keeping several rather than only `current` is not sentimentality. The proxy
serves static files from EVERY retained release (see `proxy.findStatic`), so a
client still holding the previous page's HTML can fetch its hashed chunks after
a deploy instead of getting a white screen. That needs a release or two of
depth, not forty. Retained releases are also the rollback targets, which is the
other reason the number is more than one.

Returns what it removed, and callers log it. A retention policy nobody can
observe is indistinguishable from releases disappearing on their own — the same
reason `backup.Prune` reports its deletions.
*/
func Prune(instance string, keep int) ([]string, error) {
	// A keep of zero reaching this point is a misparsed flag or a zero-valued
	// struct field, never an operator asking to delete every release. Between
	// the destructive reading of an obviously wrong input and the inert one,
	// this takes the inert one.
	if keep <= 0 {
		return nil, nil
	}

	releases, err := Releases(instance)
	if err != nil {
		// An app registered in the state but never successfully deployed has no
		// releases directory. Prune runs across every app at startup, and a hard
		// error on one empty instance would keep Bay from booting the others.
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	if len(releases) <= keep {
		return nil, nil
	}

	serving, err := servingRelease(instance)
	if err != nil {
		return nil, err
	}

	var removed []string
	for _, name := range releases[keep:] {
		if name == serving {
			continue
		}
		if err := os.RemoveAll(filepath.Join(instance, "releases", name)); err != nil {
			// Report what was already deleted alongside the failure: the caller
			// logs it, and a half-completed prune that says nothing is how disk
			// usage becomes impossible to account for.
			return removed, fmt.Errorf("remove release %s: %w", name, err)
		}
		removed = append(removed, name)
	}
	return removed, nil
}

/*
servingRelease reports which release `current` points at.

Resolved here rather than taken as an argument, and rather than assumed to be
the newest: after `bay rollback` the serving release is an OLD one, so pruning
by age alone would delete the running app's own directory out from under it.

A missing `current` is a fact, not a failure — an app whose first deploy died
between the unpack and the swap has releases and no symlink, and there is
nothing to protect. Any OTHER error is the unknown case, and the caller must
not delete anything while it cannot tell what is serving.
*/
func servingRelease(instance string) (string, error) {
	target, err := os.Readlink(filepath.Join(instance, "current"))
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("resolve current release: %w", err)
	}
	return filepath.Base(target), nil
}
