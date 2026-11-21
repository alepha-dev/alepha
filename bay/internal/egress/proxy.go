// Package egress is the forward proxy a container job reaches the world
// through (#Q3996): an allowlist of host names, checked on every CONNECT and
// every plain HTTP request, with TLS never intercepted.
package egress

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

/*
Proxy answers HTTP proxy requests for one job.

A job's network has no route out (Docker's `Internal`), so this proxy, attached
to that network and to one that does route, is the job's only way to the
world. It allows a host when its name is on the list exactly, or under an entry
that starts with a dot (`.githubusercontent.com`). Ports are 443 and 80 only.
Anything else is refused with a 403 and reported through Refused, which the job
turns into a line of its log.

It does not decrypt: a CONNECT is a byte tunnel once allowed, so the proxy sees
host names and never what goes inside.
*/
type Proxy struct {
	allow []string
	// Refused is told of every refusal; nil drops them.
	Refused func(Refusal)
	// Dial opens the upstream connection; a test substitutes it.
	Dial func(network, address string) (net.Conn, error)

	transport *http.Transport
	once      sync.Once
}

// Refusal is one request the allowlist refused.
type Refusal struct {
	Event  string `json:"event"`
	Method string `json:"method"`
	Host   string `json:"host"`
	At     string `json:"at"`
}

// New makes a proxy for an allowlist of host names.
func New(allow []string) *Proxy {
	clean := make([]string, 0, len(allow))
	for _, host := range allow {
		host = strings.ToLower(strings.TrimSpace(host))
		if host != "" {
			clean = append(clean, host)
		}
	}
	return &Proxy{allow: clean}
}

// Allows reports whether host (a name, no port) is on the list.
func (p *Proxy) Allows(host string) bool {
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	for _, entry := range p.allow {
		if strings.HasPrefix(entry, ".") {
			if strings.HasSuffix(host, entry) {
				return true
			}
			continue
		}
		if host == entry {
			return true
		}
	}
	return false
}

func (p *Proxy) dial(network, address string) (net.Conn, error) {
	if p.Dial != nil {
		return p.Dial(network, address)
	}
	return net.DialTimeout(network, address, 15*time.Second)
}

func (p *Proxy) refuse(w http.ResponseWriter, method, host string) {
	if p.Refused != nil {
		p.Refused(Refusal{Event: "egress.refused", Method: method, Host: host, At: time.Now().UTC().Format(time.RFC3339)})
	}
	http.Error(w, "egress to "+host+" is not on this job's list", http.StatusForbidden)
}

// allowed splits host:port and checks both.
func (p *Proxy) allowed(hostport, defaultPort string) (string, string, bool) {
	host, port, err := net.SplitHostPort(hostport)
	if err != nil {
		host, port = hostport, defaultPort
	}
	if port != "443" && port != "80" {
		return host, port, false
	}
	// An address literal is never on a list of names.
	if net.ParseIP(strings.Trim(host, "[]")) != nil {
		return host, port, false
	}
	return host, port, p.Allows(host)
}

func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodConnect {
		p.connect(w, r)
		return
	}
	if r.URL.Host == "" || r.URL.Scheme != "http" {
		http.Error(w, "this proxy forwards http:// requests and CONNECT tunnels only", http.StatusBadRequest)
		return
	}
	host, _, ok := p.allowed(r.URL.Host, "80")
	if !ok {
		p.refuse(w, r.Method, host)
		return
	}
	p.once.Do(func() {
		p.transport = &http.Transport{
			Proxy: nil,
			DialContext: func(_ context.Context, network, address string) (net.Conn, error) {
				return p.dial(network, address)
			},
		}
	})
	out := r.Clone(r.Context())
	out.RequestURI = ""
	out.Header.Del("Proxy-Connection")
	out.Header.Del("Proxy-Authorization")
	res, err := p.transport.RoundTrip(out)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer res.Body.Close()
	for k, values := range res.Header {
		for _, v := range values {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(res.StatusCode)
	_, _ = io.Copy(w, res.Body)
}

func (p *Proxy) connect(w http.ResponseWriter, r *http.Request) {
	host, port, ok := p.allowed(r.Host, "443")
	if !ok {
		p.refuse(w, r.Method, host)
		return
	}
	upstream, err := p.dial("tcp", net.JoinHostPort(host, port))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		upstream.Close()
		http.Error(w, "this server cannot tunnel", http.StatusInternalServerError)
		return
	}
	client, buffered, err := hijacker.Hijack()
	if err != nil {
		upstream.Close()
		return
	}
	_, _ = client.Write([]byte("HTTP/1.1 200 Connection established\r\n\r\n"))
	go func() {
		// Bytes the client sent after its CONNECT, already read.
		if n := buffered.Reader.Buffered(); n > 0 {
			pending, _ := buffered.Reader.Peek(n)
			_, _ = upstream.Write(pending)
		}
		_, _ = io.Copy(upstream, client)
		upstream.Close()
	}()
	_, _ = io.Copy(client, upstream)
	client.Close()
}

// LogRefusal writes a refusal as one JSON line, what `bay egress-proxy`
// prints for the job to read.
func LogRefusal(w io.Writer) func(Refusal) {
	var mu sync.Mutex
	return func(r Refusal) {
		raw, _ := json.Marshal(r)
		mu.Lock()
		defer mu.Unlock()
		_, _ = w.Write(append(raw, '\n'))
	}
}
