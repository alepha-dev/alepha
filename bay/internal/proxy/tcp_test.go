package proxy

import (
	"bufio"
	"net"
	"strconv"
	"testing"
)

func echoServer(t *testing.T, prefix string) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer c.Close()
				line, _ := bufio.NewReader(c).ReadString('\n')
				c.Write([]byte(prefix + line))
			}()
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port
}

func freeTCPPort(t *testing.T) int {
	ln, _ := net.Listen("tcp", ":0")
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

func roundTrip(t *testing.T, port int, msg string) string {
	t.Helper()
	c, err := net.Dial("tcp", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.Write([]byte(msg + "\n"))
	line, _ := bufio.NewReader(c).ReadString('\n')
	return line
}

func TestTCPForwarding(t *testing.T) {
	a := echoServer(t, "a:")
	b := echoServer(t, "b:")
	public := freeTCPPort(t)
	fwd := NewTCP(nil)
	defer fwd.Close()

	t.Run("a public port forwards to the service's loopback port", func(t *testing.T) {
		if failed := fwd.Sync(map[int]int{public: a}); len(failed) != 0 {
			t.Fatal(failed)
		}
		if got := roundTrip(t, public, "hello"); got != "a:hello\n" {
			t.Fatalf("got %q", got)
		}
	})

	t.Run("a moved target is repointed without closing the port", func(t *testing.T) {
		fwd.Sync(map[int]int{public: b})
		if got := roundTrip(t, public, "again"); got != "b:again\n" {
			t.Fatalf("got %q", got)
		}
	})

	t.Run("a port no longer forwarded is closed", func(t *testing.T) {
		fwd.Sync(nil)
		if fwd.Owns(public) {
			t.Fatal("still owned")
		}
		if err := PortFree(public); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("a port another process holds is reported, not taken", func(t *testing.T) {
		held, _ := net.Listen("tcp", ":0")
		defer held.Close()
		port := held.Addr().(*net.TCPAddr).Port
		if failed := fwd.Sync(map[int]int{port: a}); failed[port] == nil {
			t.Fatal("expected the busy port to be reported")
		}
	})
}
