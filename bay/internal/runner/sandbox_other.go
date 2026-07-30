//go:build !linux

package runner

// Sandbox is accepted but ignored off Linux, so the caller can build one
// unconditionally.
type Sandbox struct {
	Instance      string
	WritablePaths []string
	MemoryMax     string
	TasksMax      int
}
