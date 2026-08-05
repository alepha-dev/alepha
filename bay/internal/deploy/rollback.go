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

// migrationNames collects every migration directory or file of one release,
// keyed by dialect so `sqlite/0001_x` and `postgres/0001_x` never collide.
//
// An absent `migrations/` is not an error: plenty of apps have no database.
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
