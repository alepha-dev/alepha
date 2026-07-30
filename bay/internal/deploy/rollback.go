package deploy

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// Releases lists an app instance's retained releases, newest first.
//
// Release directories are named `2006-01-02-150405` UTC, which sorts
// lexicographically in chronological order — so a reverse string sort is the
// chronological one, with no parsing and nothing to get wrong.
func Releases(instance string) ([]string, error) {
	entries, err := os.ReadDir(filepath.Join(instance, "releases"))
	if err != nil {
		return nil, fmt.Errorf("list releases: %w", err)
	}
	var out []string
	for _, e := range entries {
		if e.IsDir() {
			out = append(out, e.Name())
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(out)))
	return out, nil
}

// MigrationsSince lists migrations present in `from` but absent from `to`.
//
// This is what rollback can NOT undo. Alepha migrations are forward-only: there
// is no down-migration, so rolling code back onto a database that has already
// moved forward is the operator's call, not something Bay may take silently.
//
// Comparing directory listings is enough, and deliberately so — Bay does not
// know what SQL is, and nothing here needs it to. Additive migrations are
// usually survivable (old code ignores a new column); a rename or a drop is
// not. Bay cannot tell those apart, so it does not pretend to: it names them and
// makes a human decide.
func MigrationsSince(instance, from, to string) ([]string, error) {
	current, err := migrationNames(instance, from)
	if err != nil {
		return nil, err
	}
	target, err := migrationNames(instance, to)
	if err != nil {
		return nil, err
	}
	inTarget := make(map[string]bool, len(target))
	for _, name := range target {
		inTarget[name] = true
	}
	var extra []string
	for _, name := range current {
		if !inTarget[name] {
			extra = append(extra, name)
		}
	}
	sort.Strings(extra)
	return extra, nil
}

// migrationNames collects every migration directory or file of one release,
// keyed by dialect so `sqlite/0001_x` and `postgres/0001_x` never collide.
//
// An absent `migrations/` is not an error: plenty of apps have no database.
func migrationNames(instance, release string) ([]string, error) {
	root := filepath.Join(instance, "releases", release, "migrations")
	var names []string
	dialects, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read migrations of %s: %w", release, err)
	}
	for _, d := range dialects {
		if !d.IsDir() {
			continue
		}
		entries, err := os.ReadDir(filepath.Join(root, d.Name()))
		if err != nil {
			return nil, fmt.Errorf("read migrations of %s: %w", release, err)
		}
		for _, e := range entries {
			// `.archive` and drizzle's `meta` hold history, not migrations to
			// apply; counting them would report differences that mean nothing.
			if e.Name() == "meta" || e.Name() == ".archive" {
				continue
			}
			names = append(names, d.Name()+"/"+e.Name())
		}
	}
	return names, nil
}

// SwapRelease repoints `current` at another release.
//
// The same temp-symlink-then-rename as a deploy, so the switch is atomic and a
// crash mid-way cannot leave `current` dangling.
func SwapRelease(instance, release string) error {
	target := filepath.Join(instance, "releases", release)
	if _, err := os.Stat(target); err != nil {
		return fmt.Errorf("release %s: %w", release, err)
	}
	current := filepath.Join(instance, "current")
	tmp := current + ".tmp"
	_ = os.Remove(tmp)
	if err := os.Symlink(target, tmp); err != nil {
		return fmt.Errorf("link release: %w", err)
	}
	if err := os.Rename(tmp, current); err != nil {
		return fmt.Errorf("swap current: %w", err)
	}
	return nil
}
