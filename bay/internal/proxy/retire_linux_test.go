package proxy

import (
	"net"
	"strconv"
	"syscall"
	"testing"
	"time"
)

/*
The socket handoff keeps a duplicate of every listening socket and never gives
one back. A port taken out of service must stop answering and be bindable
again all the same, which a close of one descriptor cannot do.
*/
func TestARetiredPortIsFreeWhileADuplicateOfItsSocketIsHeld(t *testing.T) {
	var held []int
	t.Cleanup(func() {
		for _, fd := range held {
			_ = syscall.Close(fd)
		}
	})
	tcp := NewTCP(nil)
	// What tableflip's Fds.Listen does: open, and keep a duplicate.
	tcp.Listen = func(network, addr string) (net.Listener, error) {
		ln, err := net.Listen(network, addr)
		if err != nil {
			return nil, err
		}
		raw, err := ln.(syscall.Conn).SyscallConn()
		if err != nil {
			return nil, err
		}
		_ = raw.Control(func(fd uintptr) {
			if dup, err := syscall.Dup(int(fd)); err == nil {
				held = append(held, dup)
			}
		})
		return ln, nil
	}

	probe, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	port := probe.Addr().(*net.TCPAddr).Port
	probe.Close()
	target, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()

	if failed := tcp.Sync(map[int]Forward{port: {Target: target.Addr().(*net.TCPAddr).Port}}); len(failed) != 0 {
		t.Fatalf("open: %v", failed)
	}
	addr := "127.0.0.1:" + strconv.Itoa(port)
	conn, err := net.DialTimeout("tcp", addr, time.Second)
	if err != nil {
		t.Fatalf("the open port must accept: %v", err)
	}
	conn.Close()
	if len(held) != 1 {
		t.Fatalf("the test holds %d duplicate(s), want 1", len(held))
	}

	tcp.Sync(nil)

	if conn, err := net.DialTimeout("tcp", addr, time.Second); err == nil {
		conn.Close()
		t.Fatal("a retired port still accepts connections")
	}
	if err := PortFree(port); err != nil {
		t.Fatalf("a retired port must be free to open again: %v", err)
	}
	if failed := tcp.Sync(map[int]Forward{port: {Target: target.Addr().(*net.TCPAddr).Port}}); len(failed) != 0 {
		t.Fatalf("reopening the retired port: %v", failed)
	}
	conn, err = net.DialTimeout("tcp", addr, time.Second)
	if err != nil {
		t.Fatalf("the reopened port must accept: %v", err)
	}
	conn.Close()
	tcp.Close()
}
