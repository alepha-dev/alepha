// Package runtimes resolves which interpreter binary runs an app.
//
// Bay owns the runtime lifecycle rather than borrowing whatever is on PATH.
// That is the whole point of shipping the runtime: a CVE is patched once, in
// one place, and every app picks it up on restart — instead of needing a
// rebuild and a redeploy per app.
package runtimes

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// Resolve returns the absolute path to the interpreter for a runtime and major
// version, e.g. ("node", "26") -> /opt/bay/runtimes/node-26/bin/node.
//
// The version is a MAJOR only. Bay resolves it to whatever patch it currently
// has installed, which is what keeps `bay runtime update` able to fix every app
// at once. An exact pin is rejected upstream, in the manifest validator.
func Resolve(dir, runtime, major string) (string, error) {
	if strings.ContainsAny(runtime, `/\`) || strings.ContainsAny(major, `/\`) {
		return "", fmt.Errorf("invalid runtime %q/%q", runtime, major)
	}
	if major != "" {
		candidate := filepath.Join(dir, runtime+"-"+major, "bin", runtime)
		if isExecutable(candidate) {
			return candidate, nil
		}
	}
	// No major declared: take the highest installed one, so an app that does
	// not care still gets a managed runtime rather than the system's.
	if best, err := highestInstalled(dir, runtime); err == nil {
		return best, nil
	}
	// Last resort: the system PATH. Convenient in development, but it means the
	// runtime is no longer under Bay's control — worth saying out loud.
	if p, err := exec.LookPath(runtime); err == nil {
		return p, nil
	}
	return "", fmt.Errorf("no %s runtime found in %s (major %q) nor on PATH", runtime, dir, major)
}

// Installed lists the majors available for a runtime, highest first.
func Installed(dir, runtime string) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var majors []string
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name, ok := strings.CutPrefix(e.Name(), runtime+"-")
		if !ok {
			continue
		}
		if !isExecutable(filepath.Join(dir, e.Name(), "bin", runtime)) {
			continue
		}
		majors = append(majors, name)
	}
	sort.Slice(majors, func(i, j int) bool {
		return numeric(majors[i]) > numeric(majors[j])
	})
	return majors
}

func highestInstalled(dir, runtime string) (string, error) {
	majors := Installed(dir, runtime)
	if len(majors) == 0 {
		return "", fmt.Errorf("no %s runtime installed in %s", runtime, dir)
	}
	return filepath.Join(dir, runtime+"-"+majors[0], "bin", runtime), nil
}

func numeric(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return -1
	}
	return n
}

func isExecutable(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && info.Mode().Perm()&0o111 != 0
}
