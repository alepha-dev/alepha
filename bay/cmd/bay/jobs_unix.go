//go:build unix

package main

import (
	"fmt"
	"os"
	"os/user"
	"strconv"
	"syscall"
)

// jobSysProcAttr puts a job in a process group of its own, so a kill reaches
// everything it started, and runs it as the jobs user when Bay can switch.
func jobSysProcAttr(u *user.User, switchUser bool) (*syscall.SysProcAttr, error) {
	attr := &syscall.SysProcAttr{Setpgid: true}
	if !switchUser {
		return attr, nil
	}
	uid, gid, err := userIDs(u)
	if err != nil {
		return nil, err
	}
	attr.Credential = &syscall.Credential{Uid: uid, Gid: gid, NoSetGroups: true}
	return attr, nil
}

// chownToUser gives a path Bay created to the jobs user.
func chownToUser(path string, u *user.User, switchUser bool) error {
	if !switchUser {
		return nil
	}
	uid, gid, err := userIDs(u)
	if err != nil {
		return err
	}
	if err := os.Chown(path, int(uid), int(gid)); err != nil {
		return fmt.Errorf("could not give %s to %s: %w", path, u.Username, err)
	}
	return nil
}

func userIDs(u *user.User) (uint32, uint32, error) {
	uid, err := strconv.ParseUint(u.Uid, 10, 32)
	if err != nil {
		return 0, 0, fmt.Errorf("the user %s has no numeric uid", u.Username)
	}
	gid, err := strconv.ParseUint(u.Gid, 10, 32)
	if err != nil {
		return 0, 0, fmt.Errorf("the user %s has no numeric gid", u.Username)
	}
	return uint32(uid), uint32(gid), nil
}

// killGroup signals a job's whole process group.
func killGroup(pid int, hard bool) {
	sig := syscall.SIGTERM
	if hard {
		sig = syscall.SIGKILL
	}
	_ = syscall.Kill(-pid, sig)
}
