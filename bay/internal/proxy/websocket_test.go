package proxy

import (
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/gorilla/websocket"

	"github.com/alepha-dev/bay/internal/state"
)

/*
A stack's services speak WebSocket (Keycloak's admin console, MQTT over
WebSocket for Mosquitto), so the proxy must carry an upgrade through to the
service and relay frames both ways.
*/
func TestWebSocketsPassThroughToAStackService(t *testing.T) {
	upgrader := websocket.Upgrader{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			kind, msg, err := conn.ReadMessage()
			if err != nil {
				return
			}
			_ = conn.WriteMessage(kind, append([]byte("echo:"), msg...))
		}
	}))
	defer upstream.Close()
	_, portText, _ := net.SplitHostPort(strings.TrimPrefix(upstream.URL, "http://"))

	root := t.TempDir()
	store, err := state.Open(filepath.Join(root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	port, _ := strconv.Atoi(portText)
	if err := store.Upsert(state.App{Name: "broker.mqtt", Env: "production", Domains: []string{"mqtt.broker.bay.test"},
		Port: port, Stack: "broker", Service: "mqtt", ServiceKind: "service"}); err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(New(root, store, slog.New(slog.DiscardHandler)))
	defer front.Close()

	dialer := websocket.Dialer{NetDial: func(network, _ string) (net.Conn, error) {
		return net.Dial(network, strings.TrimPrefix(front.URL, "http://"))
	}}
	conn, res, err := dialer.Dial("ws://mqtt.broker.bay.test/mqtt", nil)
	if err != nil {
		t.Fatalf("dial: %v (response %v)", err, res)
	}
	defer conn.Close()
	if err := conn.WriteMessage(websocket.TextMessage, []byte("ping")); err != nil {
		t.Fatal(err)
	}
	_, msg, err := conn.ReadMessage()
	if err != nil || string(msg) != "echo:ping" {
		t.Fatalf("msg = %q, err = %v", msg, err)
	}
}
