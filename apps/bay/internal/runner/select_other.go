//go:build !linux

package runner

// Default always supervises plain children off Linux: there is no systemd, so
// there is no isolation either. Fine for `bay dev` on a laptop, never for a host.
func Default(string) (Runner, bool) {
	return NewChild(), false
}
