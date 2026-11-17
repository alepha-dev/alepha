//go:build !linux

package proxy

import "net"

// retire closes the listener. Bay runs on Linux, where retiring a port takes
// more than this (retire_linux.go); elsewhere it is only ever built to be
// tested, with no socket handoff holding a duplicate.
func retire(ln net.Listener) { _ = ln.Close() }
