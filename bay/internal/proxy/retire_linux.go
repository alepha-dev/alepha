package proxy

import (
	"net"
	"syscall"
)

/*
retire takes a public port out of service for good, whoever else holds the
socket.

A plain Close is not enough since the socket handoff (#Q3743): the handoff
keeps a duplicate of every listening socket, to pass to the next Bay, and has
no way to give one back. Closing only this descriptor would leave the port
bound and listening with nobody accepting, so clients would hang instead of
being refused, and the port could never be opened again.

shutdown(2) acts on the socket, not on the descriptor: it leaves the listening
state everywhere at once. The port then refuses connections, and what is left
of it (bound, not listening) no longer stops anyone binding it again, since
every listener here and Docker's own set SO_REUSEADDR.
*/
func retire(ln net.Listener) {
	if sc, ok := ln.(syscall.Conn); ok {
		if raw, err := sc.SyscallConn(); err == nil {
			_ = raw.Control(func(fd uintptr) {
				_ = syscall.Shutdown(int(fd), syscall.SHUT_RDWR)
			})
		}
	}
	_ = ln.Close()
}
