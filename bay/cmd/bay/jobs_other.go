//go:build !unix

package main

import (
	"errors"
	"os"
	"os/user"
	"syscall"
)

// Jobs run on unix hosts only: there is no process group or user switch here.
func jobSysProcAttr(*user.User, bool) (*syscall.SysProcAttr, error) {
	return nil, errors.New("jobs run on unix hosts only")
}

func chownToUser(string, *user.User, bool) error { return nil }

func killGroup(pid int, _ bool) {
	if p, err := os.FindProcess(pid); err == nil {
		_ = p.Kill()
	}
}

func lockFile(string) (func(), bool, error) {
	return nil, false, errors.New("jobs run on unix hosts only")
}

func lockFileForRead(string, func() error) (func(), bool, bool, error) {
	return nil, false, false, errors.New("jobs run on unix hosts only")
}
