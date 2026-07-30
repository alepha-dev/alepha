// Package control owns the unix socket the control API is reached through.
//
// The socket exists so that no secret has to. A bearer token over loopback has
// to be handed to every legitimate caller, which means writing it into a file
// that the caller's user can read — and bay-ui, the one caller that most needs
// it, is also the one most likely to be compromised. On a unix socket the
// authorization IS the filesystem permission, arbitrated by the kernel: there is
// no string to steal, copy, leak through a log, or carry off in a backup.
//
// What this does NOT change: the privilege. Anything that can reach the control
// API can deploy code, and anything that can deploy code is root-equivalent.
// That is irreducible — deploying code is the job. The socket removes the
// secret, not the power.
package control

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
)

// maxSocketPath is the shortest platform limit on a unix socket path: macOS
// caps `sun_path` at 104 bytes, Linux at 108.
//
// Worth checking explicitly because exceeding it fails with `bind: invalid
// argument`, which says nothing about length and sends you hunting for a
// permission or a missing directory.
const maxSocketPath = 104

// SocketMode is the permission the socket is published with: owner and group
// read/write, nothing for the world.
//
// The group is the whole access-control mechanism, so a mode any wider than this
// would silently hand the control API to every local user.
const SocketMode = 0o660

// Listen publishes a unix socket that members of `group` may connect to.
//
// Returns the listener and a description of who can reach it, for logging —
// because "who can talk to the root-equivalent API" is exactly the fact an
// operator should see at startup rather than have to derive.
func Listen(path, group string) (net.Listener, string, error) {
	if len(path) >= maxSocketPath {
		return nil, "", fmt.Errorf(
			"socket path is %d bytes and the platform limit is %d: %s — use a shorter --control-socket or --root",
			len(path), maxSocketPath, path)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, "", fmt.Errorf("create socket directory: %w", err)
	}
	// A socket left behind by a killed process makes bind fail with "address
	// already in use", which reads like a port conflict and sends you looking in
	// the wrong place.
	if err := removeStale(path); err != nil {
		return nil, "", err
	}

	ln, err := net.Listen("unix", path)
	if err != nil {
		return nil, "", fmt.Errorf("listen on %s: %w", path, err)
	}

	// Order matters: chmod BEFORE chown. Between bind and chmod the socket
	// carries the process umask, which on a default root umask is 0755 —
	// world-connectable. Narrowing first keeps that window shut.
	if err := os.Chmod(path, SocketMode); err != nil {
		ln.Close()
		return nil, "", fmt.Errorf("restrict %s: %w", path, err)
	}

	if group == "" {
		return ln, "owner only (no group configured)", nil
	}
	gid, err := ensureGroup(group)
	if err != nil {
		// Not fatal: the socket is already owner-only, so Bay is reachable by
		// root and nothing else. Refusing to start would take the proxy down
		// over a group that can be created by hand.
		return ln, fmt.Sprintf("owner only (group %q unavailable: %v)", group, err), nil
	}
	if err := os.Chown(path, os.Getuid(), gid); err != nil {
		return ln, fmt.Sprintf("owner only (could not hand %s to group %q: %v)", path, group, err), nil
	}
	return ln, fmt.Sprintf("owner + group %q (gid %d)", group, gid), nil
}

// removeStale deletes a leftover socket, refusing to touch anything else.
//
// The guard matters: `path` comes from a flag, and unlinking whatever it points
// at would turn a typo into data loss.
func removeStale(path string) error {
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSocket == 0 {
		return fmt.Errorf("%s exists and is not a socket; refusing to remove it", path)
	}
	return os.Remove(path)
}

// ensureGroup resolves a unix group, creating it when absent.
//
// Created rather than required so the install path stays one command. `groupadd
// --system` is idempotent enough in practice: the lookup below is what decides.
func ensureGroup(name string) (int, error) {
	if g, err := user.LookupGroup(name); err == nil {
		return strconv.Atoi(g.Gid)
	}
	out, err := exec.Command("groupadd", "--system", name).CombinedOutput()
	if err != nil {
		return 0, fmt.Errorf("create group: %w: %s", err, strings.TrimSpace(string(out)))
	}
	g, err := user.LookupGroup(name)
	if err != nil {
		return 0, fmt.Errorf("group %s created but not resolvable: %w", name, err)
	}
	return strconv.Atoi(g.Gid)
}

// EnsureGroupExists creates the control group if it is missing.
//
// Exported so the runner can guarantee it before systemd resolves
// SupplementaryGroups: an unknown group makes the unit refuse to start with a
// message about groups rather than about the grant it was asked for.
func EnsureGroupExists(name string) error {
	_, err := ensureGroup(name)
	return err
}

// AddUserToGroup grants a unix user access to the socket.
func AddUserToGroup(username, group string) error {
	out, err := exec.Command("usermod", "--append", "--groups", group, username).CombinedOutput()
	if err != nil {
		return fmt.Errorf("add %s to %s: %w: %s", username, group, err, strings.TrimSpace(string(out)))
	}
	return nil
}
