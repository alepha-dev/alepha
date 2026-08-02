package runner

import (
	"os"
)

// maxLogBytes is the size at which app.log is rotated.
//
// 32 MiB, and exactly one generation kept. The systemd runner sends output to
// journald, which has its own retention; this ceiling exists for the child
// runner, which appends forever. Without it the log viewer is the feature that
// fills the disk — and a full disk takes down every app on the machine, not
// just the one that was chatty.
const maxLogBytes int64 = 32 << 20

// rotateIfLarge moves an oversized log aside, keeping one generation.
//
// Called on start rather than on a timer: the child runner holds the file open
// for the life of the process, and renaming a file out from under an open
// descriptor keeps the process writing to the now-invisible inode. Rotating at
// the one moment the file is about to be opened avoids that entirely.
func rotateIfLarge(path string, max int64) error {
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.Size() < max {
		return nil
	}
	return os.Rename(path, path+".1")
}
