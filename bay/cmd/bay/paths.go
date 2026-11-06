package main

import (
	"os"
	"path/filepath"
)

/*
Where a client command finds the Bay it talks to (#Q3156).

`install.sh` and the systemd unit `INSTALL.md` documents run
`bay serve --root /opt/bay/data --control-socket /run/bay/control.sock`, while
the client's own default is `./bay-data`, the layout of a developer running
`bay serve` in a checkout. Before this, the command Lore prints
(`bay connector set <url> <secret>`) failed as printed on an installed host,
and every guide repeated both flags on every client command.

One order, for the root and for the socket:

 1. the flag (`--root`, `--control-socket`);
 2. the environment (`$BAY_ROOT`, `$BAY_SOCKET`);
 3. `./bay-data`, when it is a real root (a `state.json`) or holds a socket,
    so a checkout is unaffected;
 4. the installer's layout, when it is real: `/opt/bay/data` with a
    `state.json`, `/run/bay/control.sock` being a socket.

The probe always looks for the marker, never for the directory alone: an
empty `/opt/bay/data` is not a Bay, and `connectorRoot` already trusts
`state.json` for that reason.

The installer's paths are variables so a test can point them at a temp
directory.
*/
var (
	installerRoot   = "/opt/bay/data"
	installerSocket = "/run/bay/control.sock"
)

// resolveRoot returns the root a client command should use, and which rule
// chose it. With no flag, no env and no real root at either default, it
// returns fallback: `./bay-data` for the connector (whose refusal then names
// it), the installer's root for `bay doctor`, which runs before the first
// `bay serve` and so cannot require a state.json.
func resolveRoot(args []string, fallback string) (root, source string) {
	for i, arg := range args {
		if arg == "--root" && i < len(args)-1 {
			root, source = args[i+1], "--root"
		}
	}
	if root != "" {
		return root, source
	}
	if env := os.Getenv("BAY_ROOT"); env != "" {
		return env, "$BAY_ROOT"
	}
	if isBayRoot(defaultRoot) {
		return defaultRoot, "the default root"
	}
	if isBayRoot(installerRoot) {
		return installerRoot, "the installer's root"
	}
	return fallback, "the default root"
}

// isBayRoot says whether `bay serve` has run from dir: the file it opens.
func isBayRoot(dir string) bool {
	info, err := os.Stat(filepath.Join(dir, "state.json"))
	return err == nil && info.Mode().IsRegular()
}

// isSocket says whether path is a unix socket, never just any file.
func isSocket(path string) bool {
	info, err := os.Lstat(path)
	return err == nil && info.Mode()&os.ModeSocket != 0
}
