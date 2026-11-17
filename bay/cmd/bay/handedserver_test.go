package main

import (
	"bufio"
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"testing"
	"time"
)

/*
The request http.Server.Shutdown drops: a connection that is open when the
server starts leaving, and sends its request just after.
*/
func TestAHandedServerAnswersAConnectionItAcceptedBeforeLeaving(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "answered")
	})}
	h := newHandedServer(srv, ln, false, "proxy", slog.New(slog.NewTextHandler(io.Discard, nil)))
	go h.serve()

	conn, err := net.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	// Accepted and counted, with nothing sent yet.
	deadline := time.Now().Add(5 * time.Second)
	for h.busyCount() == 0 {
		if time.Now().After(deadline) {
			t.Fatal("the connection was never accepted")
		}
		time.Sleep(time.Millisecond)
	}

	left := make(chan struct{})
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		h.leave(ctx)
		close(left)
	}()
	// The listener is closed first: nothing new is accepted here any more.
	<-h.served
	select {
	case <-left:
		t.Fatal("the server left while a connection it accepted was still to be answered")
	case <-time.After(50 * time.Millisecond):
	}

	if _, err := io.WriteString(conn, "GET / HTTP/1.1\r\nHost: bay.test\r\nConnection: close\r\n\r\n"); err != nil {
		t.Fatal(err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	res, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatalf("the request was dropped: %v", err)
	}
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK || string(body) != "answered" {
		t.Fatalf("status %d, body %q", res.StatusCode, body)
	}
	select {
	case <-left:
	case <-time.After(5 * time.Second):
		t.Fatal("the server never left once the connection was answered")
	}
}

func TestAHandedServerDoesNotWaitForAnIdleConnection(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {})}
	h := newHandedServer(srv, ln, false, "proxy", slog.New(slog.NewTextHandler(io.Discard, nil)))
	go h.serve()

	// One request on a kept-alive connection, which then sits idle.
	client := &http.Client{}
	res, err := client.Get("http://" + ln.Addr().String() + "/")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, res.Body)
	res.Body.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	started := time.Now()
	h.leave(ctx)
	if took := time.Since(started); took > 2*time.Second {
		t.Fatalf("leaving waited %s for a connection with nothing in flight", took)
	}
}
