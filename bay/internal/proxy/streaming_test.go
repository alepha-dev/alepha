package proxy

import (
	"bufio"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/state"
)

func TestChunksReachTheClientAsTheAppFlushesThem(t *testing.T) {
	// A server-rendered page streams: the shell, then a deferred value when it
	// settles. If the proxy buffered, the page would paint only once the slowest
	// value was ready, and nothing about the response would look wrong.
	release := make(chan struct{})
	app := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("<main>shell</main>\n"))
		w.(http.Flusher).Flush()
		<-release
		w.Write([]byte("<script>value</script>\n"))
	}))
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	app.Listener.Close()
	app.Listener = listener
	app.Start()
	defer app.Close()
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()

	_, portStr, _ := net.SplitHostPort(listener.Addr().String())
	port, _ := strconv.Atoi(portStr)

	p := newTestProxy(t)
	front := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p.forward(w, r, state.App{Name: "demo", Env: "production", Port: port})
	}))
	defer front.Close()

	res, err := http.Get(front.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body := bufio.NewReader(res.Body)

	shell := make(chan string, 1)
	go func() {
		line, _ := body.ReadString('\n')
		shell <- line
	}()

	select {
	case line := <-shell:
		if !strings.Contains(line, "shell") {
			t.Fatalf("first chunk: got %q", line)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the shell did not arrive before the value was ready: the proxy buffers")
	}

	close(release)

	line, err := body.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(line, "value") {
		t.Fatalf("second chunk: got %q", line)
	}
}
