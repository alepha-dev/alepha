//go:build unix

package main

import (
	"os"
	"syscall"
)

// ownerOf is the uid that owns fi, and false where the platform does not say.
func ownerOf(fi os.FileInfo) (uint32, bool) {
	st, ok := fi.Sys().(*syscall.Stat_t)
	if !ok {
		return 0, false
	}
	return st.Uid, true
}
