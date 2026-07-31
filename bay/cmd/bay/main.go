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
	"crypto/x509"
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
	"sync"
	"syscall"
	"time"

	"github.com/alepha/bay/internal/control"
	"github.com/alepha/bay/internal/deploy"
	"github.com/alepha/bay/internal/health"
	"github.com/alepha/bay/internal/manifest"
	"github.com/alepha/bay/internal/proxy"
	"github.com/alepha/bay/internal/runner"
	"github.com/alepha/bay/internal/runtimes"
	"github.com/alepha/bay/internal/schedule"
	"github.com/alepha/bay/internal/state"
	"github.com/alepha/bay/internal/tlsconf"
)

const (
	defaultRoot      = "./bay-data"
	defaultProxyAddr = ":8080"
	defaultTLSAddr   = ":8443"
	// stopGrace is what an app gets to shut down cleanly, and it is the ONLY
	// number in play — it becomes the unit's TimeoutStopSec.
	//
	// Sized against what an Alepha app actually does on SIGTERM: the HTTP
	// server stops accepting and waits out in-flight requests for up to 10
	// seconds, then database pools close and buffered telemetry flushes. 15
	// left almost no margin past the HTTP drain alone.
	stopGrace    = 30 * time.Second
	readyTimeout = 60 * time.Second
	// deployHoldWindow bounds how long requests wait during a deploy. Longer
	// than readyTimeout because the app is down for the unpack and the swap
	// too, not only for its own boot.
	deployHoldWindow = 90 * time.Second
	// defaultBackupInterval is deliberately ON by default. Backups that must be
	// switched on are backups that stay off.
	defaultBackupInterval = 24 * time.Hour
	// defaultControlGroup is the unix group whose members may reach the control
	// socket. Membership is the whole authorization: joining it is equivalent to
	// being handed the token.
	defaultControlGroup = "bay-control"
	// How long a new release is watched before it is considered settled.
	// Minutes, not hours: past that a failure is an incident for an operator,
	// and undoing a release that has served correctly is worse than the fault.
	rollbackWindow    = 2 * time.Minute
	rollbackInterval  = 10 * time.Second
	rollbackThreshold = 3
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
	// Asking for help must never do anything. `serve` in particular starts a
	// daemon that binds ports and takes over the state directory, and every
	// parse loop below ignores what it does not recognise — so without this,
	// `bay serve --help` silently boots a server.
	for _, arg := range os.Args[1:] {
		if arg == "--help" || arg == "-h" {
			usage()
			os.Exit(0)
		}
	}
	var err error
	// Every command except `serve` is a client of the control API, reached over
	// the unix socket. `--control-socket` is the only thing to resolve.
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

  bay serve   [--root DIR] [--runtimes DIR] [--addr :8080]
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
  bay version
  bay config s3 --endpoint URL --bucket NAME [--keep N]
                # credentials from BAY_S3_ACCESS_KEY / BAY_S3_SECRET_KEY
  bay backup  <name/env>          # snapshot + verify + upload
  bay backups <name/env>          # list what is stored
  bay restore <name/env> [--key K] # destructive; keeps the old db aside

Every command except "serve" is a thin client of the control API — the same API
bay-admin calls. There is no second code path.

That API listens on a unix socket and nothing else. It can create users, read
every app's secrets and delete every backup, so it is root-equivalent, and a
loopback TCP port with a shared secret is the wrong shape for that: any process
on the host can reach the port, the secret ends up in a shell history and an
environment variable, and a bind-address typo publishes it to the internet. The
socket's authorization is the file mode, enforced by the kernel — reaching it
already requires being root or in the control group.

Remote access is bay-admin's job: it authenticates people, over HTTPS, and
speaks to this socket on their behalf. Client commands accept --control-socket
PATH (or $BAY_SOCKET) and must run on the Bay host.
`)
}

// checkFlags refuses any `--flag` a command does not know.
//
// Every parse loop here is a hand-rolled `switch` that ignores what it does not
// match, so a typo is silent: `--base-domian` starts a Bay with no base domain,
// `--nmae` deploys under the manifest's project instead of the one asked for.
// Both look like success. This is the same reasoning `--backup-interval`
// already applies to its value, applied to the names as well.
//
// `boolFlags` stand alone; `valueFlags` consume the argument after them, which
// is skipped so a value that happens to start with `--` is not mistaken for a
// flag.
func checkFlags(args []string, boolFlags, valueFlags map[string]bool) error {
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if !strings.HasPrefix(arg, "--") {
			continue
		}
		switch {
		case boolFlags[arg]:
		case valueFlags[arg]:
			if i == len(args)-1 {
				return fmt.Errorf("%s needs a value", arg)
			}
			i++
		default:
			return fmt.Errorf("unknown flag %q (run `bay --help`)", arg)
		}
	}
	return nil
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
	// probe answers "is this app serving?", which is a different question from
	// "is something listening?" — see internal/health.
	probe *health.Probe
	// router is told when an app is being restarted, so requests wait for the
	// new process instead of failing. Nil in the CLI paths that never serve.
	router *proxy.Proxy
	// watches holds the cancel of each app's in-flight rollback watch, so a new
	// deploy can supersede the previous one's. See beginWatch.
	watchMu sync.Mutex
	watches map[string]context.CancelFunc
	log     *slog.Logger
}

func cmdServe(args []string) error {
	root, addr := defaultRoot, defaultProxyAddr
	tlsAddr, acmeCA, acmeEmail, acmeCARoot := defaultTLSAddr, "", "", ""
	acmeHTTPPort, acmeTLSPort := 0, 0 // 0 = CertMagic defaults, i.e. 80 and 443
	runtimesDir := ""
	baseDomain := ""
	useTLS := false
	backupInterval := defaultBackupInterval
	badBackupInterval := ""
	controlSocket := ""
	controlGroup := defaultControlGroup
	if err := checkFlags(args,
		map[string]bool{"--tls": true},
		map[string]bool{
			"--root": true, "--runtimes": true, "--base-domain": true,
			"--addr": true, "--tls-addr": true,
			"--acme-ca": true, "--acme-email": true, "--acme-ca-root": true,
			"--acme-http-port": true, "--acme-tls-port": true,
			"--control-socket": true, "--control-group": true,
			"--backup-interval": true,
		}); err != nil {
		return err
	}
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
		isolated: isolated, log: log, controlSocket: controlSocket,
		probe: &health.Probe{}}

	router := proxy.New(root, store, log)
	srv.router = router
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
	// The control API listens on a unix socket and nowhere else.
	//
	// It can create users, read every app's secrets and delete every backup.
	// A loopback TCP port with a shared secret was the wrong shape for that:
	// every process on the host could reach the port, the secret had to live in
	// a shell history and an environment variable to be usable, and a typo in
	// the bind address published it to the internet. The socket's authorization
	// is the file mode, enforced by the kernel, and reaching it already
	// requires being root or in the control group.
	//
	// Remote access has not gone away — it moved to bay-admin, which
	// authenticates people over HTTPS and speaks to this socket for them. That
	// is a system that can have accounts, revocation and an audit trail;
	// a bearer token in an environment variable can have none of the three.
	socketSrv := &http.Server{Handler: srv.controlMux()}

	go func() {
		log.Info("proxy listening", "addr", addr)
		if err := proxySrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("proxy stopped", "err", err)
		}
	}()
	// Fatal now that it is the only way in. A Bay that serves traffic but
	// cannot be deployed to, rolled back or stopped is a Bay nobody can fix,
	// and it would fail at the worst possible moment — the next incident.
	ln, reachableBy, err := control.Listen(controlSocket, controlGroup)
	if err != nil {
		return fmt.Errorf("control socket %s: %w", controlSocket, err)
	}
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
	_ = socketSrv.Shutdown(ctx)
	srv.runner.StopAll(stopGrace)
	return nil
}

/*
holdDuring makes requests for an app wait, from now until the returned function
is called.

Held from the moment Bay decides to take the app down, NOT from when it brings
it back up. The first version armed this inside `start`, which is after the
stop, after the upload has been unpacked and after the release has been swapped
— so every request in that window still got a 502. Measured: five out of 469
during a real redeploy, all of them `connection refused`, all of them before the
hold existed.

The returned release is safe to call twice, and safe not to call at all: the
deadline is a backstop for the path where Bay dies mid-deploy.
*/
func (s *server) holdDuring(key string) func() {
	if s.router == nil {
		return func() {}
	}
	s.router.HoldFor(key, deployHoldWindow)
	return func() { s.router.Release(key) }
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
			StopGrace:     stopGrace,
			ControlGroup:  controlGroupFor(app),
			// Widened only for a granted app; empty otherwise.
			ControlSocketDir: controlSocketDirFor(app, s.controlSocket),
		},
	}
	// No hold armed here. Whoever took the app down owns the window — arming it
	// at this point would mean every request between the stop and this line
	// still got a 502, which is exactly the bug this replaced. `start` is also
	// called at boot, where there is nothing to hold for.

	if err := s.runner.Start(spec); err != nil {
		return err
	}
	if err := s.probe.WaitReady(app.Port, readyTimeout); err != nil {
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

// ---------------------------------------------------------------------------
// control API — the single contract, consumed by the CLI and later by bay-ui
// ---------------------------------------------------------------------------

// controlMux builds the routes. Authorization is applied per listener by the
// caller: a bearer token on TCP, unix permissions on the socket.
func (s *server) controlMux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /apps", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, s.listApps())
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

// listedApp is a registered app plus whether it is actually answering.
//
// The stored record says what was deployed, never what is happening now: after
// `bay stop`, or after a process dies on its own, the list looked exactly like a
// healthy app. An operator reading it could not tell a running site from a dead
// one, which is the first thing the list exists to answer.
//
// Asked of the runner per request rather than written down on stop, so a crash
// reads the same as a deliberate stop — the truth, not the intent.
type listedApp struct {
	state.App
	Running bool `json:"running"`
	// Usage is what the app is costing right now — memory, CPU, restarts.
	// Absent when the supervisor has nothing to say, which is the honest
	// answer for an unsupervised child process or a stopped app. A snapshot,
	// with no history: keeping a series in the orchestrator would mean losing
	// it on every Bay upgrade, so that belongs upstack.
	Usage *runner.Usage `json:"usage,omitempty"`
}

func (s *server) listApps() []listedApp {
	apps := s.store.Apps()
	out := make([]listedApp, 0, len(apps))
	for _, app := range apps {
		entry := listedApp{
			App:     app,
			Running: s.runner.Running(app.Key()),
		}
		if usage, ok := s.runner.Usage(app.Key()); ok {
			entry.Usage = &usage
		}
		out = append(out, entry)
	}
	return out
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

	// Requests wait from here rather than 502, and keep waiting through the
	// unpack, the swap and the new process's boot.
	defer s.holdDuring(name + "/" + env)()

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
	// Watched in the background: the deploy has succeeded as far as the caller
	// is concerned, and holding the response open for a minute would make every
	// deploy feel broken. What this catches is the release that boots, answers
	// once, and dies on its first real traffic — which is exactly what a
	// readiness check at deploy time cannot see.
	if res.Previous != "" && res.Previous != res.Release {
		go s.watchAndRollback(res.App, res.Previous)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"app":           res.App,
		"release":       res.Release,
		"url":           "https://" + res.App.Domain + "/",
		"sleepEligible": res.Manifest.SleepEligible(),
		"restore":       restore,
	})
}

/*
watchAndRollback undoes a release that fails in its first minutes.

Only ever back to the release that was serving a moment ago — the one that was
demonstrably working. Walking further back would be guessing, and each step
takes the app further from what the operator believes is deployed.

Code only. Migrations are forward-only and stay applied, which is why this
window is short: the further a bad release runs, the more likely it has written
something the old code cannot read.
*/
func (s *server) watchAndRollback(app state.App, previous string) {
	// One watch per app. A deploy supersedes whatever was being watched: the
	// old watch is probing a release that is no longer installed, and its
	// verdict — reached against the NEW release's process — would roll back to
	// something older than what the operator just replaced.
	//
	// Observed, not theoretical. Two deploys six seconds apart left two watches
	// running; both saw the same wedged process, and they rolled back in
	// sequence. The second undid the first's correct work and put the app on a
	// release older than the one the deploy had replaced.
	ctx := s.beginWatch(app.Key())
	defer s.endWatch(app.Key())

	verdict := (&health.Watch{
		Probe:     s.probe,
		Port:      app.Port,
		Window:    rollbackWindow,
		Interval:  rollbackInterval,
		Threshold: rollbackThreshold,
	}).Run(ctx)

	if ctx.Err() != nil {
		// Superseded by a newer deploy. Its watch owns this app now.
		s.log.Info("watch cancelled by a newer deploy",
			"app", app.Key(), "release", app.Release)
		return
	}
	if verdict.Healthy {
		s.log.Info("release held up", "app", app.Key(),
			"release", app.Release, "checks", verdict.Checks)
		return
	}

	// Only roll back what this watch actually deployed. Between the verdict and
	// this line an operator may have deployed or rolled back by hand, and
	// reverting their release to one they never asked for is worse than leaving
	// a bad one running — they are standing right there.
	if current, ok := s.store.Get(app.Key()); !ok || current.Release != app.Release {
		s.log.Warn("release failed, but the app has already moved on — not rolling back",
			"app", app.Key(), "watched", app.Release, "reason", verdict.Reason)
		return
	}

	s.log.Error("release failed its health window, rolling back",
		"app", app.Key(), "bad", app.Release, "to", previous,
		"reason", verdict.Reason, "checks", verdict.Checks)

	instance := filepath.Join(s.root, "apps", app.Name, app.Env)
	if err := deploy.SwapRelease(instance, previous); err != nil {
		// Nothing left to try automatically. Said loudly rather than retried:
		// an app stuck between two releases needs a human, and a loop here
		// would bury the one line that says so.
		s.log.Error("ROLLBACK FAILED — app is on a bad release",
			"app", app.Key(), "err", err)
		return
	}
	if err := s.store.SetRelease(app.Key(), previous); err != nil {
		s.log.Error("rolled back on disk but not in state", "app", app.Key(), "err", err)
	}

	app.Release = previous
	if err := s.start(app); err != nil {
		s.log.Error("ROLLBACK FAILED — previous release did not start",
			"app", app.Key(), "err", err)
		return
	}
	s.log.Warn("rolled back", "app", app.Key(), "now", previous)
}

/*
beginWatch registers this goroutine as the app's only watch.

Cancels whatever was watching that app before returning, so at most one watch
can reach a verdict for a given app at a time.
*/
func (s *server) beginWatch(key string) context.Context {
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	if s.watches == nil {
		s.watches = map[string]context.CancelFunc{}
	}
	if cancel, ok := s.watches[key]; ok {
		cancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.watches[key] = cancel
	return ctx
}

// endWatch drops this app's entry, unless a newer watch has already claimed it.
func (s *server) endWatch(key string) {
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	delete(s.watches, key)
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
	if err := checkFlags(args[1:],
		map[string]bool{"--allow-control-api": true},
		map[string]bool{"--name": true, "--env": true, "--domain": true,
			"--control-socket": true}); err != nil {
		return err
	}
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

	url := fmt.Sprintf(controlHost+"/apps?name=%s&env=%s&domain=%s", name, env, domain)
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
	res, err := call(http.MethodGet, controlHost+"/apps", nil)
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

	raw, err := call(http.MethodGet, controlHost+"/apps", nil)
	if err != nil {
		return err
	}
	var apps []struct {
		Name            string        `json:"name"`
		Env             string        `json:"env"`
		Domain          string        `json:"domain"`
		Release         string        `json:"release"`
		Running         bool          `json:"running"`
		Usage           *runner.Usage `json:"usage"`
		Backups         bool          `json:"backups"`
		LastBackupAt    string        `json:"lastBackupAt"`
		LastBackupError string        `json:"lastBackupError"`
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

		// A registered app that is not running is the loudest thing this
		// command can say, and it used to say nothing at all.
		if !a.Running {
			problems++
			fmt.Printf("  process  ⚠ NOT RUNNING\n")
		} else if u := a.Usage; u != nil {
			fmt.Printf("  process  %s, %s cpu%s\n",
				humanBytes(u.MemoryBytes), time.Duration(u.CPUSeconds*float64(time.Second)).Round(time.Second),
				uptimeSuffix(u.StartedAt, now))
			// Restarts are what distinguishes an app that is up from an app
			// that keeps coming back up. `is-active` cannot tell them apart.
			if u.Restarts > 0 {
				problems++
				fmt.Printf("           ⚠ restarted %d time(s) — check logs/app.log\n", u.Restarts)
			}
		} else {
			fmt.Printf("  process  running\n")
		}

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

// humanBytes renders a byte count an operator can read at a glance.
//
// Rounded to one decimal: the difference between 431.2M and 431.7M has never
// changed anyone's mind, and the extra digits make a column harder to scan.
func humanBytes(n int64) string {
	switch {
	case n >= 1<<30:
		return fmt.Sprintf("%.1fG", float64(n)/(1<<30))
	case n >= 1<<20:
		return fmt.Sprintf("%.0fM", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.0fK", float64(n)/(1<<10))
	default:
		return fmt.Sprintf("%dB", n)
	}
}

// uptimeSuffix says how long the CURRENT run has lasted.
//
// Empty when systemd did not report a start time rather than printing "up 0s",
// which would read as an app that just restarted.
func uptimeSuffix(startedAt, now time.Time) string {
	if startedAt.IsZero() {
		return ""
	}
	return fmt.Sprintf(", up %s", now.Sub(startedAt).Round(time.Second))
}

// cmdRemove unregisters an app, keeping its data unless asked otherwise.
func cmdRemove(args []string) error {
	key, err := appKey(args, "remove")
	if err != nil {
		return err
	}
	if err := checkFlags(args[1:],
		map[string]bool{"--purge": true},
		map[string]bool{"--control-socket": true}); err != nil {
		return err
	}
	url := controlHost + "/apps/" + key
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
	res, err := call(http.MethodGet, controlHost+"/apps/"+key+"/releases", nil)
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
	if err := checkFlags(args[1:],
		map[string]bool{"--confirm": true},
		map[string]bool{"--to": true, "--control-socket": true}); err != nil {
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
	res, err := call(http.MethodPost, controlHost+"/apps/"+key+"/rollback"+query, nil)
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
	res, err := call(http.MethodPost, controlHost+"/apps/"+key+"/stop", nil)
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

/*
controlHost is the host part of every control-API URL.

The transport dials a unix socket, so the host is never resolved and never
connected to — but net/http still needs the URL to parse, and a request with no
Host header is rejected before it reaches the socket. A name rather than an
address so nothing about this reads as a network destination.
*/
const controlHost = "http://bay"

// readControlFlag extracts `--control-socket PATH` from a client command.
func readControlFlag(args []string) {
	for i, arg := range args {
		if i >= len(args)-1 {
			continue
		}
		if arg == "--control-socket" {
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

	sock := controlSocketPath()
	if sock == "" {
		return "", errors.New(
			"no control socket found — these commands run on the Bay host, " +
				"as root or as a member of the control group " +
				"(see --control-socket / $BAY_SOCKET). " +
				"For remote deploys, use bay-admin")
	}
	// Dial the socket instead of the network. The URL's host is ignored by the
	// transport but still has to parse, so callers keep composing
	// http://bay/path exactly as before.
	client.Transport = &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", sock)
		},
	}

	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return "", err
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
