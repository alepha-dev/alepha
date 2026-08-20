package runner

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// protectedHomes are the trees `ProtectHome=yes` replaces with an empty one,
// so a unit cannot see them whatever their permissions say.
var protectedHomes = []string{"/home", "/root", "/run/user"}

// AssertReachable fails when an app's own user cannot reach the working
// directory its unit will be given.
//
// Why this runs before the unit does: systemd reports the failure as
// `status=200/CHDIR`, Bay reports it upstream as "never became ready", and the
// operator is left with an app that logs nothing because it never executed a
// line. Neither message names a directory mode. It cost hours on a first
// install, where the installer created the data root `0700` and every app under
// it died at CHDIR; the whole diagnosis is one stat per parent directory.
//
// Diagnostics must never be the reason a deploy fails, so anything this cannot
// establish (an unresolvable user, an unreadable parent) is not an error: it
// returns nil and lets the start proceed.
func AssertReachable(user, dir string) error {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil
	}
	abs = filepath.Clean(abs)

	if home := protectedHome(abs); home != "" {
		return fmt.Errorf(
			"working directory %s is under %s, which the app cannot see: its unit sets ProtectHome=yes, so systemd gives it an empty %s. Point Bay's --root at a directory outside %s, for example /opt/bay/data",
			abs, home, home, strings.Join(protectedHomes, ", "),
		)
	}

	uid, gids, err := credentials(user)
	if err != nil {
		return nil
	}
	blocked := blockedAncestor(abs, uid, gids)
	if blocked == nil {
		return nil
	}
	// The mode bits are the usual answer but not the only one: a POSIX ACL can
	// grant what they deny. Refusing to start is severe enough to be worth
	// asking the kernel itself before doing it.
	if reachableAs(uid, gids, abs) {
		return nil
	}
	return fmt.Errorf(
		"app user %s cannot enter its working directory %s: %s is %s owned by uid %d gid %d, and that blocks traversal, not only listing. Every app runs as its own user, so each directory above the app needs its execute bit (chmod 0711 keeps a directory unlistable while letting each app through)",
		user, abs, blocked.path, blocked.mode, blocked.uid, blocked.gid,
	)
}

// dirOwner is what deciding traversal needs from one directory.
type dirOwner struct {
	path string
	mode os.FileMode
	uid  uint32
	gid  uint32
}

// protectedHome returns the ProtectHome tree containing path, or "".
func protectedHome(path string) string {
	for _, home := range protectedHomes {
		if path == home || strings.HasPrefix(path, home+"/") {
			return home
		}
	}
	return ""
}

// blockedAncestor returns the first directory on path, walking down from the
// root, that uid/gids cannot traverse. It returns nil when the whole path is
// traversable, and also when it cannot tell: a component that does not exist
// yet is the caller's business, not a permission problem.
//
// The walk is lexical. A symlinked component is resolved by Stat, so its target
// is what gets tested, but the target's own parents are not walked separately.
func blockedAncestor(path string, uid uint32, gids []uint32) *dirOwner {
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	current := "/"
	for _, part := range parts {
		if part != "" {
			current = filepath.Join(current, part)
		}
		info, err := os.Stat(current)
		if err != nil {
			return nil
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok {
			return nil
		}
		if !canTraverse(info.Mode(), stat.Uid, stat.Gid, uid, gids) {
			return &dirOwner{path: current, mode: info.Mode(), uid: stat.Uid, gid: stat.Gid}
		}
	}
	return nil
}

// canTraverse reports whether uid, carrying gids, may pass through a directory
// with this mode and ownership.
//
// POSIX picks ONE class and stops there, which is the part that surprises: a
// directory owned by the app user as `0077` denies the owner despite granting
// everyone else, so falling through to the other bits would answer yes where
// the kernel answers no.
func canTraverse(mode os.FileMode, ownerUID, ownerGID, uid uint32, gids []uint32) bool {
	if uid == 0 {
		return true // CAP_DAC_OVERRIDE: root ignores the execute bits
	}
	perm := mode.Perm()
	if uid == ownerUID {
		return perm&0o100 != 0
	}
	for _, gid := range gids {
		if gid == ownerGID {
			return perm&0o010 != 0
		}
	}
	return perm&0o001 != 0
}

// credentials resolves the app user's uid and every group it carries.
//
// Via `id` rather than os/user because the rest of this file already shells out
// for `useradd` and `chown`, and because `id -G` answers the supplementary
// groups an operator may have added, which a passwd lookup alone would miss and
// would then read as a directory the user cannot reach.
func credentials(user string) (uint32, []uint32, error) {
	out, err := exec.Command("id", "-u", user).Output()
	if err != nil {
		return 0, nil, fmt.Errorf("resolve uid of %s: %w", user, err)
	}
	uid, err := strconv.ParseUint(strings.TrimSpace(string(out)), 10, 32)
	if err != nil {
		return 0, nil, fmt.Errorf("parse uid of %s: %w", user, err)
	}
	out, err = exec.Command("id", "-G", user).Output()
	if err != nil {
		return 0, nil, fmt.Errorf("resolve groups of %s: %w", user, err)
	}
	var gids []uint32
	for _, field := range strings.Fields(string(out)) {
		gid, err := strconv.ParseUint(field, 10, 32)
		if err != nil {
			return 0, nil, fmt.Errorf("parse group of %s: %w", user, err)
		}
		gids = append(gids, uint32(gid))
	}
	if len(gids) == 0 {
		return 0, nil, fmt.Errorf("no groups for %s", user)
	}
	return uint32(uid), gids, nil
}

// reachableAs asks the kernel the question the mode bits only approximate, by
// doing exactly what the unit will do: enter the directory as that user.
//
// Inconclusive counts as unreachable. This runs only once the mode walk has
// already found a blocked directory, so "no /bin/true on this host" leaves the
// walk's verdict standing rather than overturning it.
func reachableAs(uid uint32, gids []uint32, dir string) bool {
	const probe = "/bin/true"
	if _, err := os.Stat(probe); err != nil {
		return false
	}
	cmd := exec.Command(probe)
	cmd.Dir = dir
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Credential: &syscall.Credential{Uid: uid, Gid: gids[0], Groups: gids},
	}
	return cmd.Run() == nil
}
