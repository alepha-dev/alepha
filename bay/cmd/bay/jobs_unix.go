//go:build unix

package main

import (
	"errors"
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

// lockFile takes an exclusive, non-blocking lock on path, created if it is
// missing. The kernel releases it when the process dies, so a Bay that died
// mid-job leaves no stale lock behind.
func lockFile(path string) (func(), bool, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, false, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) {
			return nil, false, nil
		}
		return nil, false, err
	}
	return func() {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		f.Close()
	}, true, nil
}

/*
lockFileForRead takes a lock a reader shares with other readers, refused by a
writer's exclusive lockFile. When no one holds the lock it is taken
exclusively first and `whileAlone` runs under it, the one moment a reader may
change what every reader sees; then it is turned into a shared lock. It
answers whether whileAlone ran, and false for `ok` when a writer holds it.
*/
func lockFileForRead(path string, whileAlone func() error) (unlock func(), alone, ok bool, err error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, false, false, err
	}
	fd := int(f.Fd())
	unlock = func() {
		_ = syscall.Flock(fd, syscall.LOCK_UN)
		f.Close()
	}
	if err := syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB); err == nil {
		if whileAlone != nil {
			if err := whileAlone(); err != nil {
				unlock()
				return nil, false, false, err
			}
		}
		// Held alone, so turning it shared waits for nobody.
		if err := syscall.Flock(fd, syscall.LOCK_SH); err != nil {
			unlock()
			return nil, false, false, err
		}
		return unlock, true, true, nil
	} else if !errors.Is(err, syscall.EWOULDBLOCK) {
		f.Close()
		return nil, false, false, err
	}
	if err := syscall.Flock(fd, syscall.LOCK_SH|syscall.LOCK_NB); err != nil {
		f.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) {
			return nil, false, false, nil
		}
		return nil, false, false, err
	}
	return unlock, false, true, nil
}

// foreground keeps a process in the caller's process group, for a sign-in
// that reads the caller's terminal (bay jobs setup).
func foreground(attr *syscall.SysProcAttr) {
	if attr != nil {
		attr.Setpgid = false
	}
}
