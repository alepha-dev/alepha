//go:build !linux

package runner

import "time"

// Sandbox is accepted but ignored off Linux, so the caller can build one
// unconditionally.
type Sandbox struct {
	Instance      string
	WritablePaths []string
	MemoryMax     string
	TasksMax      int
	// CPUQuota is a cgroup CPU ceiling in systemd's spelling, e.g. "100%" for
	// one core. Like MemoryMax it does nothing off Linux, where apps are plain
	// child processes with no cgroup to charge.
	CPUQuota string
	// StopGrace is enforced by systemd's TimeoutStopSec in production. Off
	// Linux the Child runner applies it itself, between SIGTERM and SIGKILL.
	StopGrace time.Duration
}
