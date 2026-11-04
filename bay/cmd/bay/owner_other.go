//go:build !unix

package main

import "os"

// ownerOf is the uid that owns fi, and false where the platform does not say.
func ownerOf(os.FileInfo) (uint32, bool) { return 0, false }
