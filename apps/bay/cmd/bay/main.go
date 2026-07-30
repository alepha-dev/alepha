// Command bay is the Bay control plane: reverse proxy, app supervisor and
// control API in one binary.
//
// PoC scope — no systemd (absent on macOS), so apps run as child processes
// behind the runner interface. Everything else is the real design, TLS
// included: point --acme-ca at Pebble to exercise ACME without a domain.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/alepha/bay/internal/control"
	"github.com/alepha/bay/internal/deploy"
	"github.com/alepha/bay/internal/manifest"
	"github.com/alepha/bay/internal/proxy"
	"github.com/alepha/bay/internal/runner"
	"github.com/alepha/bay/internal/runtimes"
	"github.com/alepha/bay/internal/schedule"
	"github.com/alepha/bay/internal/state"
	"github.com/alepha/bay/internal/tlsconf"
)

const (
	defaultRoot        = "./bay-data"
	defaultProxyAddr   = ":8080"
	defaultControlAddr = "127.0.0.1:7717"
	defaultTLSAddr     = ":8443"
	stopGrace          = 15 * time.Second
	readyTimeout       = 60 * time.Second
	// defaultBackupInterval is deliberately ON by default. Backups that must be
	// switched on are backups that stay off.
	defaultBackupInterval = 24 * time.Hour
	// defaultControlGroup is the unix group whose members may reach the control
	// socket. Membership is the whole authorization: joining it is equivalent to
	// being handed the token.
	defaultControlGroup = "bay-control"
)

// version is stamped at link time by the release workflow:
//
//	go build -ldflags "-X main.version=0.25.0"
//
// "dev" for any locally built binary, which is the honest answer — a hand-built
// binary corresponds to no release.
//
// This exists because "which binary is running?" is the first question when
// something is wrong, and the release/redeploy coupling makes it load-bearing:
// a Bay newer than its releases refuses to start apps whose release predates
// the derived manifest, and the operator needs to see that mismatch.
var version = "dev"

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	// Every command except `serve` is a client of the control API, so they all
	// honour `--control`. `serve` parses it itself, as the address to LISTEN on.
	if os.Args[1] != "serve" {
		readControlFlag(os.Args[2:])
	}
	switch os.Args[1] {
	case "serve":
		err = cmdServe(os.Args[2:])
	case "deploy":
		err = cmdDeploy(os.Args[2:])
	case "list":
		err = cmdList(os.Args[2:])
	case "status":
		err = cmdStatus(os.Args[2:])
	case "releases":
		err = cmdReleases(os.Args[2:])
	case "rollback":
		err = cmdRollback(os.Args[2:])
	case "remove":
		err = cmdRemove(os.Args[2:])
	case "stop":
		err = cmdStop(os.Args[2:])
	case "token":
		err = cmdToken(os.Args[2:])
	case "config":
		if len(os.Args) > 2 && os.Args[2] == "s3" {
			err = cmdConfigS3(os.Args[3:])
		} else {
			err = errors.New("usage: bay config s3 --endpoint … --bucket …")
		}
	case "backup":
		err = cmdBackup(os.Args[2:])
	case "backups":
		err = cmdBackups(os.Args[2:])
	case "restore":
		err = cmdRestore(os.Args[2:])
	case "version", "--version", "-v":
		fmt.Println(version)
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `bay — Alepha application server (PoC)

  bay serve   [--root DIR] [--runtimes DIR] [--addr :8080] [--control 127.0.0.1:7717]
              [--base-domain bay.example.com]
              [--tls] [--tls-addr :8443] [--acme-ca URL] [--acme-email MAIL]
              [--acme-ca-root FILE.pem]   # trust a private CA (Pebble, step-ca)
              [--acme-http-port N] [--acme-tls-port N]   # challenge ports, default 80/443
              [--backup-interval 24h]   # 0 disables; needs "bay config s3"
  bay deploy  <app.tar.gz> [--name NAME] [--env ENV] [--domain HOST]
              # --name defaults to the artifact's project, and drives BOTH the
              # instance key and the subdomain: one app, one identity
              [--allow-control-api]   # ⚠ root-equivalent; apps get NO access by default
  bay list
  bay status                      # releases + backup freshness
  bay stop    <name/env>
  bay remove  <name/env> [--purge]  # unregister; data is KEPT unless --purge
  bay releases <name/env>          # what you could roll back to
  bay rollback <name/env> [--to RELEASE] [--confirm]
              # code only: migrations are forward-only and stay applied
  bay token
  bay version
  bay config s3 --endpoint URL --bucket NAME [--keep N]
                # credentials from BAY_S3_ACCESS_KEY / BAY_S3_SECRET_KEY
  bay backup  <name/env>          # snapshot + verify + upload
  bay backups <name/env>          # list what is stored
  bay restore <name/env> [--key K] # destructive; keeps the old db aside

Every command except "serve" is a thin client of the control API — the same API
bay-ui calls. There is no second code path. Client commands accept
--control ADDR (default 127.0.0.1:7717, or $BAY_CONTROL) and read $BAY_TOKEN.
`)
}

// ---------------------------------------------------------------------------
// serve
// ---------------------------------------------------------------------------

type server struct {
	// controlSocket is where the control API listens, so a granted app can be
	// given write access to exactly that directory and nothing more.
	controlSocket string
	root          string
	runtimes      string
	store         *state.Store
	runner        runner.Runner
	isolated      bool
	tls           *tlsconf.Manager
	log           *slog.Logger
}

func cmdServe(args []string) error {
	root, addr, controlTCP := defaultRoot, defaultProxyAddr, defaultControlAddr
	tlsAddr, acmeCA, acmeEmail, acmeCARoot := defaultTLSAddr, "", "", ""
	acmeHTTPPort, acmeTLSPort := 0, 0 // 0 = CertMagic defaults, i.e. 80 and 443
	runtimesDir := ""
	baseDomain := ""
	useTLS := false
	backupInterval := defaultBackupInterval
	badBackupInterval := ""
	controlSocket := ""
	controlGroup := defaultControlGroup
	for i, arg := range args {
		if arg == "--tls" {
			useTLS = true
		}
		if i >= len(args)-1 {
			continue
		}
		switch arg {
		case "--root":
			root = args[i+1]
		case "--runtimes":
			runtimesDir = args[i+1]
		case "--base-domain":
			baseDomain = args[i+1]
		case "--addr":
			addr = args[i+1]
		case "--control":
			controlTCP = args[i+1]
		case "--tls-addr":
			tlsAddr = args[i+1]
		case "--acme-ca":
			acmeCA = args[i+1]
		case "--acme-email":
			acmeEmail = args[i+1]
		case "--acme-ca-root":
			acmeCARoot = args[i+1]
		case "--acme-http-port":
			acmeHTTPPort, _ = strconv.Atoi(args[i+1])
		case "--acme-tls-port":
			acmeTLSPort, _ = strconv.Atoi(args[i+1])
		case "--control-socket":
			controlSocket = args[i+1]
		case "--control-group":
			controlGroup = args[i+1]
		case "--backup-interval":
			d, parseErr := time.ParseDuration(args[i+1])
			if parseErr == nil {
				backupInterval = d
			} else {
				// Refusing is better than silently falling back to the default:
				// a typo would leave someone believing backups are configured.
				badBackupInterval = args[i+1]
			}
		}
	}
	if badBackupInterval != "" {
		return fmt.Errorf("--backup-interval %q is not a duration (try 24h, 12h, 0 to disable)", badBackupInterval)
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	if runtimesDir == "" {
		runtimesDir = filepath.Join(filepath.Dir(root), "runtimes")
	}
	runtimesDir, err = filepath.Abs(runtimesDir)
	if err != nil {
		return err
	}

	if controlSocket == "" {
		controlSocket = filepath.Join(root, "control.sock")
	}

	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	store, err := state.Open(filepath.Join(root, "state.json"))
	if err != nil {
		return err
	}
	token, err := store.Token(func() string { return "bay_" + mustHex(24) })
	if err != nil {
		return err
	}
	if baseDomain != "" {
		if err := store.SetBaseDomain(baseDomain); err != nil {
			return err
		}
	}
	sup, isolated := runner.Default("")
	if !isolated {
		// Saying this every boot on purpose. Without per-app users, one app's
		// remote-code-execution bug reaches every other app's secrets, every
		// database, the control token and the backup credentials.
		log.Warn("apps run WITHOUT isolation (no systemd or not root): " +
			"a compromise in one app reaches all the others")
	}
	srv := &server{root: root, runtimes: runtimesDir, store: store, runner: sup,
		isolated: isolated, log: log, controlSocket: controlSocket}

	router := proxy.New(root, store, log)
	var httpHandler http.Handler = router

	// TLS is obtained synchronously at startup: a certificate that cannot be
	// issued must surface now, not as a browser warning in three months.
	if useTLS {
		domains := make([]string, 0, len(store.Apps()))
		for _, a := range store.Apps() {
			if a.Domain != "" {
				domains = append(domains, a.Domain)
			}
		}
		// Trusting a private CA (Pebble, step-ca) is what makes the whole TLS
		// path exercisable without a public domain.
		var roots *x509.CertPool
		if acmeCARoot != "" {
			pem, err := os.ReadFile(acmeCARoot)
			if err != nil {
				return fmt.Errorf("read acme ca root: %w", err)
			}
			roots = x509.NewCertPool()
			if !roots.AppendCertsFromPEM(pem) {
				return errors.New("acme ca root contains no usable certificate")
			}
		}
		mgr, err := tlsconf.New(context.Background(), tlsconf.Options{
			Domains:      domains,
			TrustedRoots: roots,
			Email:        acmeEmail,
			CADirectory:  acmeCA,
			StoragePath:  filepath.Join(root, "certs"),
			// On-demand issuance for subdomains deployed after startup, gated on
			// the app registry: an unknown host must never reach the CA, or a
			// stray DNS record burns the failed-validation quota.
			Allow: store.HasDomain,
			// These must match where the CA is told to look, otherwise the
			// challenge is served on one port and validated on another.
			HTTPPort: acmeHTTPPort,
			TLSPort:  acmeTLSPort,
			Logger:   log,
		})
		if err != nil {
			return err
		}
		srv.tls = mgr
		// ACME HTTP-01 challenges ride the plain-HTTP listener; everything else
		// falls through to the proxy.
		httpHandler = mgr.HTTPChallengeHandler(router)

		// The challenge handler goes on BOTH listeners. A proxy in front with
		// "Always Use HTTPS" turns the plain-HTTP challenge into a 301, and the
		// CA follows it — so the challenge must also be answerable over TLS,
		// otherwise issuance fails behind Cloudflare and the error says nothing
		// useful.
		tlsSrv := &http.Server{
			Addr:      tlsAddr,
			Handler:   mgr.HTTPChallengeHandler(router),
			TLSConfig: mgr.TLSConfig(),
		}
		go func() {
			log.Info("tls proxy listening", "addr", tlsAddr, "domains", domains)
			if err := tlsSrv.ListenAndServeTLS("", ""); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Error("tls proxy stopped", "err", err)
			}
		}()
	}

	proxySrv := &http.Server{Addr: addr, Handler: httpHandler}
	mux := srv.controlMux()
	// TCP needs the token: a loopback socket has no notion of who is calling, so
	// a shared secret is the only thing standing between the control API and any
	// local process.
	controlSrv := &http.Server{Addr: controlTCP, Handler: authMiddleware(token, mux)}
	// The unix socket needs NO token, and that is the point: its authorization is
	// the file mode, enforced by the kernel. Reaching it already required being
	// root or in the control group, so demanding a secret on top would only mean
	// writing that secret into a file for every legitimate caller to read.
	socketSrv := &http.Server{Handler: mux}

	go func() {
		log.Info("proxy listening", "addr", addr)
		if err := proxySrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("proxy stopped", "err", err)
		}
	}()
	go func() {
		log.Info("control api listening", "addr", controlTCP, "auth", "bearer token")
		if err := controlSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("control api stopped", "err", err)
		}
	}()

	if ln, reachableBy, err := control.Listen(controlSocket, controlGroup); err != nil {
		// Not fatal. The socket is a convenience over the TCP listener, and Bay
		// is the reverse proxy — refusing to start would take every site down
		// over an access path that has an alternative.
		log.Error("control socket unavailable; falling back to the token over TCP",
			"path", controlSocket, "err", err)
	} else {
		defer ln.Close()
		// Logged because "who can talk to the root-equivalent API" is the fact an
		// operator should be handed, not have to derive from a mode bit.
		log.Info("control socket listening", "path", controlSocket,
			"auth", "unix permissions", "reachableBy", reachableBy)
		go func() {
			if err := socketSrv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Error("control socket stopped", "err", err)
			}
		}()
	}

	// Bring previously deployed apps back up after a bay restart.
	for _, app := range store.Apps() {
		if err := srv.start(app); err != nil {
			log.Error("restore failed", "app", app.Key(), "err", err)
		}
	}

	// Scheduled backups. Started after the apps are up so the first catch-up run
	// snapshots databases that are being served, which is the state a restore has
	// to cope with anyway.
	backupCtx, stopBackups := context.WithCancel(context.Background())
	defer stopBackups()
	go srv.backupLoop(backupCtx, backupInterval)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	log.Info("shutting down")
	// Before draining: a backup in flight holds the app's runtime and would
	// outlive the process it belongs to.
	stopBackups()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = proxySrv.Shutdown(ctx)
	_ = controlSrv.Shutdown(ctx)
	_ = socketSrv.Shutdown(ctx)
	srv.runner.StopAll(stopGrace)
	return nil
}

// start launches an app and waits for it to answer.
//
// Starting and being ready are different things: routing traffic at a process
// that is still running migrations is exactly the mistake this separation
// prevents.
func (s *server) start(app state.App) error {
	instance := filepath.Join(s.root, "apps", app.Name, app.Env)
	env, err := runner.LoadEnvFile(filepath.Join(instance, ".env"))
	if err != nil {
		return err
	}
	m, err := manifest.LoadFromRelease(filepath.Join(instance, "current"))
	if err != nil {
		return err
	}
	bin, err := runtimes.Resolve(s.runtimes, m.Runtime, m.RuntimeVersion)
	if err != nil {
		return err
	}

	// Every writable path below exists because the manifest declared the
	// resource that needs it. Declaring `$bucket` is what grants write access to
	// storage/; not declaring it denies it.
	writable := []string{filepath.Join(instance, "scratch")}
	if m.Resources.Database {
		writable = append(writable, filepath.Join(instance, "data"))
	}
	if m.Resources.Bucket {
		writable = append(writable, filepath.Join(instance, "storage"))
	}

	spec := runner.Spec{
		Key:     app.Key(),
		Dir:     filepath.Join(instance, "current"),
		Runtime: bin,
		Entry:   m.Entry,
		Env:     env,
		LogFile: filepath.Join(instance, "logs", "app.log"),
		Sandbox: runner.Sandbox{
			Instance:      instance,
			WritablePaths: writable,
			MemoryMax:     "512M",
			TasksMax:      256,
			ControlGroup:  controlGroupFor(app),
			// Widened only for a granted app; empty otherwise.
			ControlSocketDir: controlSocketDirFor(app, s.controlSocket),
		},
	}
	if err := s.runner.Start(spec); err != nil {
		return err
	}
	if err := waitReady(app.Port, readyTimeout); err != nil {
		return fmt.Errorf("%s never became ready: %w", app.Key(), err)
	}
	if app.ControlAPI {
		s.log.Warn("app has ROOT-EQUIVALENT control API access",
			"app", app.Key(),
			"why", "granted with --allow-control-api",
			"means", "may deploy code, read other apps' secrets, delete backups")
	}
	s.log.Info("app ready", "app", app.Key(), "port", app.Port, "domain", app.Domain)
	return nil
}

// controlGroupFor returns the control group when this app was granted access.
//
// Empty for every app by default: nothing reaches the control API unless an
// operator said so. Warned about on every start, not just at grant time — a
// privilege that was reviewed once, months ago, is one nobody remembers.
// controlSocketDirFor returns the directory to make writable for a granted app.
func controlSocketDirFor(app state.App, socketPath string) string {
	if !app.ControlAPI || socketPath == "" {
		return ""
	}
	return filepath.Dir(socketPath)
}

func controlGroupFor(app state.App) string {
	if !app.ControlAPI {
		return ""
	}
	return defaultControlGroup
}

func waitReady(port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", addr, 500*time.Millisecond)
		if err == nil {
			conn.Close()
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("timeout after %s", timeout)
}

// ---------------------------------------------------------------------------
// control API — the single contract, consumed by the CLI and later by bay-ui
// ---------------------------------------------------------------------------

// controlMux builds the routes. Authorization is applied per listener by the
// caller: a bearer token on TCP, unix permissions on the socket.
func (s *server) controlMux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /apps", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, s.store.Apps())
	})
	mux.HandleFunc("POST /apps", s.handleDeploy)
	mux.HandleFunc("DELETE /apps/{name}/{env}", s.handleRemove)
	mux.HandleFunc("POST /apps/{name}/{env}/stop", func(w http.ResponseWriter, r *http.Request) {
		key := r.PathValue("name") + "/" + r.PathValue("env")
		if err := s.runner.Stop(key, stopGrace); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"stopped": key})
	})
	s.registerBackupRoutes(mux)
	return mux
}

func (s *server) handleDeploy(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	name, env, domain := q.Get("name"), q.Get("env"), q.Get("domain")
	if env == "" {
		env = "production"
	}

	tmp, err := os.CreateTemp("", "bay-upload-*.tar.gz")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer os.Remove(tmp.Name())
	if _, err := io.Copy(tmp, r.Body); err != nil {
		tmp.Close()
		writeError(w, http.StatusBadRequest, "upload failed: "+err.Error())
		return
	}
	tmp.Close()

	// Stop the previous process before swapping `current` under it.
	_ = s.runner.Stop(name+"/"+env, stopGrace)

	allowControl := q.Get("allowControlApi") == "yes"
	if allowControl {
		s.log.Warn("granting ROOT-EQUIVALENT control API access", "app", name+"/"+env)
	}
	res, err := deploy.Run(deploy.Options{
		Root: s.root, Artifact: tmp.Name(), Name: name, Env: env,
		Domain: domain, BaseDomain: s.store.BaseDomain(),
		AllowControlAPI: allowControl,
	}, s.store)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// Restore BEFORE starting: the app must open the recovered database, not an
	// empty one that gets swapped under it. And only when Bay just created that
	// empty file — never over an existing database.
	restore := map[string]any{"database": "existing"}
	if res.DatabaseCreated && res.DatabasePath != "" {
		restore = s.maybeAutoRestore(r.Context(), res.App, res.DatabasePath)
	}

	if err := s.start(res.App); err != nil {
		writeError(w, http.StatusBadGateway,
			"app deployed but did not become ready, see logs/app.log: "+err.Error(),
			map[string]any{"release": res.Release, "restore": restore},
		)
		return
	}
	if s.tls != nil {
		if err := s.tls.Manage(r.Context(), []string{res.App.Domain}); err != nil {
			s.log.Error("certificate for new domain failed", "domain", res.App.Domain, "err", err)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"app":           res.App,
		"release":       res.Release,
		"url":           "https://" + res.App.Domain + "/",
		"sleepEligible": res.Manifest.SleepEligible(),
		"restore":       restore,
	})
}

// handleRemove stops an app and unregisters it.
//
// Data is KEPT by default — the database, the uploads and the `.env` stay on
// disk. Removing an app from the registry is usually "stop serving this", and a
// command that also destroys data cannot be undone by redeploying. `?purge=yes`
// asks for the destructive version, and says what it deleted.
func (s *server) handleRemove(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("name") + "/" + r.PathValue("env")
	app, existed, err := s.store.Remove(key)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !existed {
		writeError(w, http.StatusNotFound, "unknown app "+key)
		return
	}
	if err := s.runner.Stop(key, stopGrace); err != nil {
		s.log.Error("stop failed while removing", "app", key, "err", err)
	}

	instance := filepath.Join(s.root, "apps", app.Name, app.Env)
	purged := false
	if r.URL.Query().Get("purge") == "yes" {
		if err := os.RemoveAll(instance); err != nil {
			writeError(w, http.StatusInternalServerError, "purge: "+err.Error())
			return
		}
		purged = true
	}
	s.log.Info("removed app", "app", key, "domain", app.Domain, "purged", purged)
	writeJSON(w, http.StatusOK, map[string]any{
		"removed": key,
		"domain":  app.Domain,
		"purged":  purged,
		// Said even when nothing was deleted, so "where did my data go" never
		// needs asking.
		"dataKeptAt": map[string]any{"path": instance, "kept": !purged},
	})
}

// authMiddleware enforces the bearer token.
//
// The control API is root-equivalent and lives on loopback, where any local
// process can reach it — unlike a unix socket, file permissions protect
// nothing here, so the token is not optional.
func authMiddleware(token string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if subtle.ConstantTimeCompare([]byte(got), []byte(token)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}

// writeError answers with Alepha's HTTP error shape.
//
// `{error, status, message}` — where `error` is the error NAME and `message` is
// the human text. Bay used to put the message in `error`, which is exactly
// where Alepha's `HttpClient` looks for the *name*: any Alepha app calling the
// control API (bay-ui included) got an `HttpError` with an empty message, and
// the operator lost the one sentence that said what to do — "rebuild with
// `alepha build --target=bare`", "redeploy the app to migrate it".
//
// One error shape across the whole system, so every Alepha client understands
// Bay for free.
func writeError(w http.ResponseWriter, code int, message string, extra ...map[string]any) {
	body := map[string]any{
		"error":   http.StatusText(code),
		"status":  code,
		"message": message,
	}
	for _, e := range extra {
		for k, v := range e {
			body[k] = v
		}
	}
	writeJSON(w, code, body)
}

// ---------------------------------------------------------------------------
// client commands
// ---------------------------------------------------------------------------

func cmdDeploy(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: bay deploy <app.tar.gz> --name NAME --domain HOST [--env ENV]")
	}
	artifact := args[0]
	name, env, domain := "", "production", ""
	allowControl := false
	for i := 1; i < len(args); i++ {
		// Checked before the value-taking flags so a trailing --allow-control-api
		// is not silently dropped by the i<len-1 bound.
		if args[i] == "--allow-control-api" {
			allowControl = true
			continue
		}
		if i >= len(args)-1 {
			continue
		}
		switch args[i] {
		case "--name":
			name = args[i+1]
		case "--env":
			env = args[i+1]
		case "--domain":
			domain = args[i+1]
		}
	}
	body, err := os.Open(artifact)
	if err != nil {
		return err
	}
	defer body.Close()

	url := fmt.Sprintf("http://%s/apps?name=%s&env=%s&domain=%s", controlAddr(), name, env, domain)
	if allowControl {
		// Said out loud on the way out, not just recorded. This grant is
		// root-equivalent and the operator should read it as they type it.
		fmt.Fprintln(os.Stderr,
			"⚠ granting "+name+"/"+env+" ROOT-EQUIVALENT access to Bay's control API: "+
				"it will be able to deploy code, read other apps' secrets and delete backups")
		url += "&allowControlApi=yes"
	}
	res, err := call(http.MethodPost, url, body)
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

func cmdList([]string) error {
	res, err := call(http.MethodGet, "http://"+controlAddr()+"/apps", nil)
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

// cmdStatus renders what an operator needs to decide whether anything is wrong.
//
// The backup column is the reason this command exists. A schedule that runs is
// not what protects data — noticing that it stopped is — and nobody notices by
// reading JSON. So the age is spelled out, and a stale one is called out rather
// than left for the reader to compute.
func cmdStatus(args []string) error {
	interval := defaultBackupInterval
	for i, arg := range args {
		if arg == "--backup-interval" && i < len(args)-1 {
			if d, err := time.ParseDuration(args[i+1]); err == nil {
				interval = d
			}
		}
	}

	raw, err := call(http.MethodGet, "http://"+controlAddr()+"/apps", nil)
	if err != nil {
		return err
	}
	var apps []struct {
		Name            string `json:"name"`
		Env             string `json:"env"`
		Domain          string `json:"domain"`
		Release         string `json:"release"`
		Backups         bool   `json:"backups"`
		LastBackupAt    string `json:"lastBackupAt"`
		LastBackupError string `json:"lastBackupError"`
	}
	if err := json.Unmarshal([]byte(raw), &apps); err != nil {
		return fmt.Errorf("parse control api response: %w", err)
	}
	if len(apps) == 0 {
		fmt.Println("no apps deployed")
		return nil
	}

	now := time.Now()
	problems := 0
	for _, a := range apps {
		fmt.Printf("%s/%s\n", a.Name, a.Env)
		fmt.Printf("  domain   %s\n", a.Domain)
		fmt.Printf("  release  %s\n", a.Release)

		switch {
		case !a.Backups:
			// Not a warning: there is nothing Bay could have backed up — either the
			// app declares no database, or it supplied its own DATABASE_URL. Bay
			// cannot tell which from here, so the message does not claim a cause it
			// does not know. Said out loud regardless, because "no backup" must
			// never be something the reader infers from an absent line.
			fmt.Printf("  backup   no Bay-managed database — nothing to snapshot\n")
		default:
			stale, age := schedule.Stale(a.LastBackupAt, now, interval)
			switch {
			case a.LastBackupAt == "":
				fmt.Printf("  backup   NEVER\n")
			default:
				fmt.Printf("  backup   %s (%s ago)\n", a.LastBackupAt, age.Round(time.Minute))
			}
			if stale {
				problems++
				fmt.Printf("           ⚠ stale — expected every %s\n", interval)
			}
		}
		if a.LastBackupError != "" {
			problems++
			fmt.Printf("           ⚠ last attempt failed: %s\n", a.LastBackupError)
		}
		// Deliberately not printed: what is NOT covered even on success. A restore
		// gives back the database and not storage/, and someone reading a healthy
		// line should know that before they need it.
		if a.Backups {
			fmt.Printf("           storage/ is not backed up\n")
		}
		fmt.Println()
	}
	if problems > 0 {
		// Non-zero exit so this is usable from a cron or a monitor without
		// parsing the text.
		return fmt.Errorf("%d problem(s) above", problems)
	}
	return nil
}

// cmdRemove unregisters an app, keeping its data unless asked otherwise.
func cmdRemove(args []string) error {
	key, err := appKey(args, "remove")
	if err != nil {
		return err
	}
	url := "http://" + controlAddr() + "/apps/" + key
	for _, arg := range args {
		if arg == "--purge" {
			fmt.Fprintln(os.Stderr,
				"⚠ --purge deletes "+key+"'s database, uploads and .env. This cannot be undone by redeploying.")
			url += "?purge=yes"
		}
	}
	res, err := call(http.MethodDelete, url, nil)
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

func cmdReleases(args []string) error {
	key, err := appKey(args, "releases")
	if err != nil {
		return err
	}
	res, err := call(http.MethodGet, "http://"+controlAddr()+"/apps/"+key+"/releases", nil)
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

// cmdRollback swaps an app back to an earlier release.
//
// `--confirm` is only needed when migrations were applied since the target. The
// server decides that, not this client: a confirmation that fires when there is
// no risk teaches people to pass the flag reflexively.
func cmdRollback(args []string) error {
	key, err := appKey(args, "rollback")
	if err != nil {
		return err
	}
	query := ""
	for i, arg := range args {
		switch arg {
		case "--to":
			if i < len(args)-1 {
				query = addParam(query, "to", args[i+1])
			}
		case "--confirm":
			query = addParam(query, "confirm", "yes")
		}
	}
	res, err := call(http.MethodPost, "http://"+controlAddr()+"/apps/"+key+"/rollback"+query, nil)
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

func addParam(query, k, v string) string {
	if query == "" {
		return "?" + k + "=" + v
	}
	return query + "&" + k + "=" + v
}

// appKey validates the "name/env" argument shared by the per-app commands.
func appKey(args []string, cmd string) (string, error) {
	if len(args) == 0 {
		return "", errors.New("usage: bay " + cmd + " <name/env>")
	}
	key := args[0]
	if !strings.Contains(key, "/") {
		return "", errors.New("expected <name/env>, got " + key)
	}
	return key, nil
}

func cmdStop(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: bay stop <name/env>")
	}
	key := args[0]
	if !strings.Contains(key, "/") {
		key += "/production"
	}
	res, err := call(http.MethodPost, "http://"+controlAddr()+"/apps/"+key+"/stop", nil)
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

func cmdToken(args []string) error {
	root := defaultRoot
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "--root" {
			root = args[i+1]
		}
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	store, err := state.Open(filepath.Join(abs, "state.json"))
	if err != nil {
		return err
	}
	token, err := store.Token(func() string { return "bay_" + mustHex(24) })
	if err != nil {
		return err
	}
	fmt.Println(token)
	return nil
}

// controlAddr resolves where the client should reach the control API.
//
// `--control` is accepted on every client command as well as on `serve`: it was
// silently ignored on the client side, so `bay deploy --control 127.0.0.1:7799`
// dialled the default port and failed with a bare `connection refused`. A flag
// accepted-but-ignored is worse than no flag at all.
func controlAddr() string {
	if a := controlFlag; a != "" {
		return a
	}
	if a := os.Getenv("BAY_CONTROL"); a != "" {
		return a
	}
	return defaultControlAddr
}

// controlFlag holds `--control` when a client command was given one. Set once
// in main, before any command runs.
var controlFlag string

// readControlFlag extracts `--control ADDR` from a client command's arguments.
func readControlFlag(args []string) {
	for i, arg := range args {
		if i >= len(args)-1 {
			continue
		}
		switch arg {
		case "--control":
			controlFlag = args[i+1]
		case "--control-socket":
			socketFlag = args[i+1]
		}
	}
}

// controlSocketPath returns the socket to prefer, if one is reachable.
//
// Tried before the token because on the host itself the socket is both the
// simpler path and the safer one: no secret has to be fetched, exported, or left
// in a shell history. `--control-socket` and $BAY_SOCKET override; otherwise the
// default sits next to the state file.
func controlSocketPath() string {
	if p := socketFlag; p != "" {
		return p
	}
	if p := os.Getenv("BAY_SOCKET"); p != "" {
		return p
	}
	// Only worth guessing when the default root is in play; a custom --root moves
	// it, and silently probing the wrong path would be worse than not probing.
	candidate := filepath.Join(defaultRoot, "control.sock")
	if info, err := os.Lstat(candidate); err == nil && info.Mode()&os.ModeSocket != 0 {
		return candidate
	}
	return ""
}

// socketFlag holds --control-socket for client commands.
var socketFlag string

func call(method, url string, body io.Reader) (string, error) {
	client := &http.Client{Timeout: 5 * time.Minute}
	token := os.Getenv("BAY_TOKEN")

	if sock := controlSocketPath(); sock != "" {
		// Dial the socket instead of the network. The URL's host is ignored by the
		// transport but still has to parse, so callers can keep composing
		// http://host/path exactly as before.
		client.Transport = &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, "unix", sock)
			},
		}
	} else if token == "" {
		return "", errors.New(
			"no control socket found and BAY_TOKEN is unset — run this on the Bay host, " +
				"or run `bay token` and export it (see --control-socket / $BAY_SOCKET)")
	}

	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return "", err
	}
	// Sent even over the socket: harmless there (the listener ignores it) and it
	// keeps a single code path for both transports.
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("control api unreachable (is `bay serve` running?): %w", err)
	}
	defer res.Body.Close()

	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return "", err
	}
	var pretty bytes.Buffer
	if json.Indent(&pretty, raw, "", "  ") == nil {
		raw = pretty.Bytes()
	}
	if res.StatusCode >= 400 {
		// The control API answers Alepha's error shape, so `message` is the
		// sentence written for whoever is reading — print that rather than the
		// whole JSON body.
		var apiErr struct {
			Message string `json:"message"`
		}
		if json.Unmarshal(raw, &apiErr) == nil && apiErr.Message != "" {
			return "", fmt.Errorf("%s: %s", res.Status, apiErr.Message)
		}
		return "", fmt.Errorf("%s: %s", res.Status, raw)
	}
	return string(raw), nil
}

// appKeyArg extracts a "name/env" argument, defaulting the environment.
func appKeyArg(args []string, usage string) (string, error) {
	if len(args) == 0 {
		return "", errors.New("usage: " + usage)
	}
	key := args[0]
	if !strings.Contains(key, "/") {
		key += "/production"
	}
	return key, nil
}

func bytesReader(b []byte) io.Reader { return bytes.NewReader(b) }

func mustHex(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return hex.EncodeToString(buf)
}
