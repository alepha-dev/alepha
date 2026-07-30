//go:build linux

package runner

import "os"

// Default picks the supervision backend.
//
// systemd only when running as root: creating users, writing units and calling
// systemctl all need it. Falling back to plain children otherwise is honest —
// but it means no isolation, so the caller must say so out loud.
func Default(unitDir string) (Runner, bool) {
	if os.Geteuid() == 0 {
		return NewSystemd(unitDir), true
	}
	return NewChild(), false
}
