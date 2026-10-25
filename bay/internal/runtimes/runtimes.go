// Package runtimes maps a manifest's runtime and major to the image an
// archive app runs in (images.go).
//
// Bay no longer ships interpreters (epic E73): a patched runtime reaches
// every app through `bay runtimes update`, which moves the pinned images to
// their newest digest, instead of through a binary Bay installs.
package runtimes

import "strconv"

func numeric(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return -1
	}
	return n
}
