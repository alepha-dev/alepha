package runner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

/*
dockerAPI is the slice of the Docker Engine API the Docker runner speaks.

Plain HTTP over the daemon's unix socket rather than the Docker SDK: the SDK is
a module graph several times the size of Bay's, for the dozen calls below, and
every one of them is a documented, versioned endpoint. The version is pinned in
the path, so a daemon upgrade cannot change a response shape under Bay.
*/
type dockerAPI struct {
	client *http.Client
	// base is the scheme, the placeholder host and the pinned API version. The
	// host is never resolved: the transport dials the socket whatever it says.
	base string
}

// dockerAPIVersion is the oldest Engine API this runner relies on. 1.44 is
// Docker 25, and the oldest version Docker 29 still accepts.
const dockerAPIVersion = "v" + MinDockerAPI

// DefaultDockerSocket is where the daemon listens on every supported host.
const DefaultDockerSocket = "/var/run/docker.sock"

/*
dockerSocket picks the socket from DOCKER_HOST when it names a unix socket, the
default otherwise.

A tcp:// DOCKER_HOST is refused rather than followed: the Engine API is
root-equivalent, and Bay only ever speaks it over a socket whose file mode is
the authorization, the same rule as its own control socket.
*/
func dockerSocket() (string, error) {
	host := os.Getenv("DOCKER_HOST")
	if host == "" {
		return DefaultDockerSocket, nil
	}
	if path, ok := strings.CutPrefix(host, "unix://"); ok {
		return path, nil
	}
	return "", fmt.Errorf("DOCKER_HOST=%s: Bay only talks to Docker over a unix socket", host)
}

func newDockerAPI(socket string) *dockerAPI {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, "unix", socket)
		},
	}
	return &dockerAPI{
		client: &http.Client{Transport: transport},
		base:   "http://docker/" + dockerAPIVersion,
	}
}

// dockerError is a non-2xx answer, kept whole so callers can branch on the
// status (404 "no such container" is routinely not a failure).
type dockerError struct {
	Status  int
	Message string
}

func (e *dockerError) Error() string {
	return fmt.Sprintf("docker: %d %s", e.Status, e.Message)
}

func isStatus(err error, status int) bool {
	de, ok := err.(*dockerError)
	return ok && de.Status == status
}

/*
do sends one request and decodes a JSON answer into `out` when it is not nil.

Every call carries a deadline. A daemon that accepts the connection and never
answers would otherwise wedge whatever asked: a deploy, the inventory, the
console's logs.
*/
func (d *dockerAPI) do(method, path string, query url.Values, body, out any, timeout time.Duration) error {
	raw, err := d.raw(method, path, query, body, timeout)
	if err != nil {
		return err
	}
	if out == nil || len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("docker: %s %s: decode: %w", method, path, err)
	}
	return nil
}

// raw is `do` without the decoding, for the endpoints that answer a stream.
func (d *dockerAPI) raw(method, path string, query url.Values, body any, timeout time.Duration) ([]byte, error) {
	return d.rawWith(method, path, query, body, nil, timeout)
}

// rawWith is raw with extra request headers: a pull's X-Registry-Auth.
func (d *dockerAPI) rawWith(method, path string, query url.Values, body any, headers map[string]string, timeout time.Duration) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(encoded)
	}
	target := d.base + path
	if len(query) > 0 {
		target += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, target, reader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := d.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("docker: %s %s: %w", method, path, err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, fmt.Errorf("docker: %s %s: read: %w", method, path, err)
	}
	if res.StatusCode >= 300 {
		return nil, &dockerError{Status: res.StatusCode, Message: dockerMessage(data)}
	}
	return data, nil
}

// dockerMessage pulls the daemon's own sentence out of an error body, which is
// `{"message": "..."}` on every endpoint, falling back to the raw text.
func dockerMessage(body []byte) string {
	var parsed struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(body, &parsed) == nil && parsed.Message != "" {
		return parsed.Message
	}
	return strings.TrimSpace(string(body))
}
