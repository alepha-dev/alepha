//go:build !linux

package runner

// Sandbox is accepted but ignored off Linux, so the caller can build one
// unconditionally.
type Sandbox struct {
	Instance      string
	WritablePaths []string
	MemoryMax     string
	TasksMax      int
	// ControlGroup is accepted here so cmd/bay compiles on macOS, but nothing
	// off Linux can honour it: a plain child process inherits the parent's
	// groups, which for `bay serve` in development means root's. Development is
	// therefore MORE permissive than production, not less — worth knowing before
	// concluding from a dev run that a grant is working.
	ControlGroup     string
	ControlSocketDir string
}
