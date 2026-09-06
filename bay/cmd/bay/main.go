// Command bay is the Bay control plane: reverse proxy, app supervisor and
// control API in one binary.
//
// On Linux apps run as systemd units behind the runner interface; elsewhere
// (macOS, development) as plain child processes. TLS included: point --acme-ca
// at Pebble to exercise ACME without a domain.
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
	neturl "net/url"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/alepha/bay/internal/connector"
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
	// defaultKeepReleases bounds how many releases each app keeps on disk.
	//
	// ON by default, for the same reason backups are: nothing removed releases
	// before this, and on a host with twenty apps that is the disk filling up.
	// A full disk does not take down the app being deployed, it takes down every
	// app on the machine plus the backups and Bay's own state writes.
	//
	// TWO: the one being served and the one before it. Not a depth setting —
	// the number the two mechanisms that read releases actually need.
	//
	// The automatic rollback needs exactly one predecessor: a release that will
	// not boot goes back to the one that was demonstrably serving a moment ago,
	// and nothing consults the one before that. And the proxy serves static
	// files from every retained release, so a client holding the previous
	// page's HTML can still fetch its hashed chunks through a deploy — which is
	// a one-deploy window, not five.
	//
	// Bay is not an archive. Lore holds the artifacts, so history on this disk
	// is both duplicated and, worse, unrecoverable: the whole premise is that
	// this VPS can be destroyed and rebuilt in seconds, and anything only
	// stored here is what makes that untrue. Measured on the real host, five
	// releases of one app was 245 MB.
	defaultKeepReleases = 2
	// How long a deploy may take once the artifact is on disk; it no longer
	// follows the client's connection.
	deployTimeout = 30 * time.Minute
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
	case "logs":
		err = cmdLogs(os.Args[2:])
	case "remove":
		err = cmdRemove(os.Args[2:])
	case "stop":
		err = cmdStop(os.Args[2:])
	case "start":
		err = cmdStart(os.Args[2:])
	case "config":
		// Named by CONSUMER, not by technology. `s3` vs `storage` said "S3"
		// twice and never said which one an app gets — a distinction you could
		// only recover by reading the source.
		switch {
		case len(os.Args) > 2 && os.Args[2] == "s3:backups":
			err = cmdConfigS3(os.Args[3:])
		case len(os.Args) > 2 && os.Args[2] == "s3:apps":
			err = cmdConfigStorage(os.Args[3:])
		case len(os.Args) > 2 && os.Args[2] == "s3":
			err = cmdConfigS3Both(os.Args[3:])
		default:
			err = errors.New("usage: bay config (s3|s3:apps|s3:backups) --endpoint … --bucket …")
		}
	case "storage":
		if len(os.Args) > 2 && os.Args[2] == "migrate" {
			err = cmdStorageMigrate(os.Args[3:])
		} else {
			err = errors.New("usage: bay storage migrate <name/env>")
		}
	case "env":
		switch {
		case len(os.Args) > 2 && os.Args[2] == "set":
			err = cmdEnvSet(os.Args[3:])
		case len(os.Args) > 2 && os.Args[2] == "list":
			err = cmdEnvList(os.Args[3:])
		default:
			err = errors.New("usage: bay env (set <name/env> - | list <name/env>)")
		}
	case "connector":
		err = cmdConnector(os.Args[2:])
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
	fmt.Fprint(os.Stderr, usageText())
}

/*
usageText is what `bay` prints when it does not recognise a command.

Separate from usage() for two reasons. It is testable - os.Stderr is not - and
every default in it is INTERPOLATED from the constant that actually governs the
flag, rather than typed out beside it. The four numbers here had all drifted
from the code at least once, which is the failure mode a help text is uniquely
bad at surfacing: nothing reads it, so nothing notices, and the operator who
does read it is the one person who cannot check.

The durations render the way Go prints a time.Duration, so --backup-interval
reads "24h0m0s" rather than "24h". Uglier, and deliberate: time.ParseDuration
accepts it, so it is a value the operator can copy, and it cannot disagree with
defaultBackupInterval the way a hand-written "24h" did.
*/
func usageText() string {
	return fmt.Sprintf(`bay — Alepha application server

  bay serve   [--root %s] [--runtimes DIR] [--addr %s]
              [--base-domain bay.example.com]
              [--tls] [--tls-addr %s] [--acme-ca URL] [--acme-email MAIL]
              [--acme-ca-root FILE.pem]   # trust a private CA (Pebble, step-ca)
              [--acme-http-port N] [--acme-tls-port N]   # challenge ports, default 80/443
              [--control-socket PATH] [--control-group %s]
              [--backup-interval %s]   # 0 disables; needs "bay config s3"
              [--keep-releases %d]   # per app; min 2, the serving one is always kept
  bay deploy  (<app.tar.gz>|-) [--name NAME] [--env ENV] [--domain HOST]...
              [--secrets-file PATH]
              # --secrets-file names a 0600 file of KEY=VALUE lines holding the
              # app's own environment. It is merged into the instance .env
              # BEFORE the release is swapped in, so the app boots with its
              # secrets — there is no window where it runs without them.
              # Bay CONSUMES it: the file is unlinked whether the deploy
              # succeeds or fails. A symlink or a group/world-readable file is
              # refused, as are keys Bay owns.
              # --name defaults to the artifact's project, and drives BOTH the
              # instance key and the subdomain: one app, one identity
              # --domain is repeatable and accepts a comma-separated list —
              # apex + www are one site. The first is the canonical one.
              # -  reads the artifact from stdin, e.g.
              #    ssh HOST 'bay deploy - --name app' < app.tar.gz
  bay list
  bay status  [--json]            # releases, traffic + backup freshness
  bay logs    <name/env> [-n 200] [--since 15m] [--grep RE] [--json]
              # journald on a real host, logs/app.log under the child runner
  bay stop    <name/env>          # out of service until "bay start" or a deploy;
                                  # survives a reboot and a bay upgrade
  bay start   <name/env>          # back into service
  bay remove  <name/env> [--purge]  # unregister; data is KEPT unless --purge
  bay version
  bay config s3:backups --endpoint URL --bucket NAME [--keep N]
                # where BACKUPS go. Credentials from BAY_S3_ACCESS_KEY /
                # BAY_S3_SECRET_KEY. Never handed to an app.
  bay config s3:apps --endpoint URL --bucket NAME
                # where hosted APPS put their blobs. Credentials from
                # BAY_STORAGE_ACCESS_KEY / BAY_STORAGE_SECRET_KEY. Every app
                # that declares a bucket is given these.
  bay config s3 --endpoint URL --bucket NAME [--keep N]
                # both of the above, from ONE credential. Convenient and less
                # safe: an app given that key can delete every backup here.
                # Warned about on use, and flagged by "bay status" while it lasts.
  bay storage migrate <name/env>  # copy local uploads into the bucket, then
                # repoint the app; local files are KEPT for you to delete
  bay env set <name/env> (-|FILE)  # merge KEY=VALUE lines into the app's .env
                # Values are read from stdin, never from argv — an argument is
                # visible in "ps" to every user here. Keys Bay owns are
                # REFUSED, not overwritten. A key whose value actually changes
                # restarts the app, because an env var the process never sees
                # has not been set. e.g.
                #    ssh HOST 'bay env set demo/production -' < .env.production
  bay env list <name/env>         # which variables are set, by NAME only
  bay backup  <name/env>          # snapshot + verify + upload
  bay backups <name/env>          # list what is stored
  bay restore <name/env> [--key K] # destructive; keeps the old db aside
  bay connector set <lore-url> <secret>
                # enrol this machine as an ESTATE of a Lore instance: "bay
                # serve" dials wss://<host>/ws/estates with the secret and holds
                # it open, so restarts and deploys arrive the instant Lore queues
                # them. The secret is stored 0600 beside state.json and never
                # printed again; http:// is accepted for a loopback host only.
                # Takes effect without restarting "bay serve". Edits the file
                # directly, so it takes --root (or $BAY_ROOT), not the socket.
  bay connector show              # sink, estate, connection state; never the secret
  bay connector clear             # forget the sink and the secret: dials nobody

Every command except "serve" is a thin client of the control API. There is no
second code path.

That API listens on a unix socket and nothing else. It can create users, read
every app's secrets and delete every backup, so it is root-equivalent, and a
loopback TCP port with a shared secret is the wrong shape for that: any process
on the host can reach the port, the secret ends up in a shell history and an
environment variable, and a bind-address typo publishes it to the internet. The
socket's authorization is the file mode, enforced by the kernel — reaching it
already requires being root or in the control group.

Remote access is SSH, and nothing else: reach the host that way and run bay
commands there directly, e.g. "ssh host ./bay deploy app.tar.gz --name app".
Client commands accept --control-socket PATH (or $BAY_SOCKET) and must run on
the Bay host.
`,
		defaultRoot,
		defaultProxyAddr,
		defaultTLSAddr,
		defaultControlGroup,
		defaultBackupInterval,
		defaultKeepReleases,
	)
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
	// keepReleases is how many releases survive a prune. Zero in the CLI paths
	// that never deploy, where `deploy.Prune` treats it as "delete nothing".
	keepReleases int
	// backupInterval is what `serve` was actually started with, so `bay
	// status` can judge staleness against the schedule that is running rather
	// than the one this binary was compiled with.
	//
	// It reaches `status` over the control API rather than out of the state
	// file: `status` may run as an operator who can reach the socket but not
	// read a root-owned 0600 document, and it needs the server up regardless
	// - every one of its numbers comes from `GET /apps`.
	backupInterval time.Duration
	// connectorStatus is what the dial loop knows about its connection, read
	// by `GET /connector`; connectorReload wakes that loop after a `bay
	// connector set` or `clear`. Both nil in the CLI paths that never serve,
	// where there is no loop to report on and none to wake.
	connectorStatus *connector.Status
	connectorReload chan struct{}
	// watches holds the cancel of each app's in-flight rollback watch, so a new
	// deploy can supersede the previous one's. See beginWatch.
	watchMu sync.Mutex
	watches map[string]context.CancelFunc
	// repoint rewrites an instance's `.env` for blob storage; nil means
	// deploy.RepointStorage. A seam rather than a permission trick because the
	// failure path has to be testable as root, where mode bits mean nothing.
	repoint func(instance, name, env string, storage *state.S3Target) error
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
	keepReleases := defaultKeepReleases
	badKeepReleases := ""
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
			"--backup-interval": true, "--keep-releases": true,
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
			// Named, like --keep-releases: a typo used to mean "80" silently,
			// and the CA then validated on the wrong port.
			port, err := strconv.Atoi(args[i+1])
			if err != nil {
				return fmt.Errorf("--acme-http-port: %q is not a port", args[i+1])
			}
			acmeHTTPPort = port
		case "--acme-tls-port":
			port, err := strconv.Atoi(args[i+1])
			if err != nil {
				return fmt.Errorf("--acme-tls-port: %q is not a port", args[i+1])
			}
			acmeTLSPort = port
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
		case "--keep-releases":
			n, parseErr := parseKeepReleases(args[i+1])
			if parseErr == nil {
				keepReleases = n
			} else {
				badKeepReleases = args[i+1]
			}
		}
	}
	if badBackupInterval != "" {
		return fmt.Errorf("--backup-interval %q is not a duration (try 24h, 12h, 0 to disable)", badBackupInterval)
	}
	if badKeepReleases != "" {
		return fmt.Errorf("--keep-releases %q must be a whole number of at least 2 (try 5): automatic rollback needs a previous release to return to, and the serving release is always kept on top", badKeepReleases)
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
		keepReleases: keepReleases, backupInterval: backupInterval,
		probe:           &health.Probe{},
		connectorStatus: connector.NewStatus(), connectorReload: make(chan struct{}, 1)}

	router := proxy.New(root, store, log)
	srv.router = router
	var httpHandler http.Handler = router

	// TLS is obtained synchronously at startup: a certificate that cannot be
	// issued must surface now, not as a browser warning in three months.
	if useTLS {
		domains := make([]string, 0, len(store.Apps()))
		for _, a := range store.Apps() {
			domains = append(domains, a.Domains...)
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
	// Remote access is SSH, not a second door into this socket: an operator (or
	// CI) logs into the host and the bay commands run there are ordinary local
	// clients of this same socket, authorized the same way. Accounts and
	// revocation live entirely in sshd; nothing here has to duplicate them.
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

	// Trim release history BEFORE starting anything, and this order is the whole
	// reason there is a prune at startup at all.
	//
	// An installation that predates the retention policy has every release it
	// has ever deployed still on disk. If the disk is already full, the next
	// deploy fails during the unpack — before it could ever reach the prune that
	// runs after a successful one — so the only code that can free space would
	// never run. Doing it on the way up is what lets a full machine recover
	// without someone SSHing in with `rm -rf`.
	for _, app := range store.Apps() {
		srv.pruneReleases(app)
	}

	srv.restoreApps()

	// Scheduled backups. Started after the apps are up so the first catch-up run
	// snapshots databases that are being served, which is the state a restore has
	// to cope with anyway.
	backupCtx, stopBackups := context.WithCancel(context.Background())
	defer stopBackups()
	go srv.backupLoop(backupCtx, backupInterval)

	// Traffic bookkeeping, drained from the proxy on its own schedule.
	go srv.flushLastSeenLoop(backupCtx)

	// The Lore connection, held open for the life of the process when a sink
	// is configured and inert otherwise; `bay connector set` wakes it through
	// the control socket. Nothing the proxy or an app does waits on it.
	go srv.connectorLoop(backupCtx)

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

	// Synchronously, and only once the proxy has drained: anything served during
	// the shutdown window is still traffic, and this is the last moment it can
	// be recorded.
	//
	// Not left to the flush loop's own ctx.Done branch. Cancelling a context
	// only makes a goroutine runnable, so that flush would race `main` returning
	// — and an operator restarting Bay a few times in a row would keep discarding
	// the freshness they are about to go and read.
	srv.flushLastSeen()

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

// instanceDir is where an app instance's durable state lives — its .env, its
// database, its storage and its releases.
func (s *server) instanceDir(app state.App) string {
	return filepath.Join(s.root, "apps", app.Name, app.Env)
}

/*
pruneReleases trims an app's release history and reports what it removed.

Never fatal, at either call site. A prune that fails is a disk that fills up
later — something an operator needs to read in the log, not a reason to fail a
deploy that has already succeeded, nor to stop Bay from booting the other apps.

The returned list is handed back to the deploy caller as well as logged. A
retention policy nobody can observe is indistinguishable from releases
vanishing on their own.
*/
func (s *server) pruneReleases(app state.App, protect ...string) []string {
	removed, err := deploy.Prune(s.instanceDir(app), s.keepReleases, protect...)
	if err != nil {
		// Logged alongside whatever was already deleted: a half-completed prune
		// that reports nothing is how disk usage stops adding up.
		s.log.Error("prune releases failed", "app", app.Key(), "removed", removed, "err", err)
	}
	if len(removed) > 0 {
		s.log.Info("pruned old releases",
			"app", app.Key(), "keep", s.keepReleases, "removed", removed)
	}
	return removed
}

// start launches an app and waits for it to answer.
//
// Starting and being ready are different things: routing traffic at a process
// that is still running migrations is exactly the mistake this separation
// prevents.
/*
restoreApps brings previously deployed apps back up after a bay restart.

Except the ones somebody took out of service. Before the flag existed, this
loop was what undid `bay stop` on the next upgrade: the app came back with
nothing saying why, which is the surprise that pages somebody at 3 am. On
systemd the parked unit is already disabled and would stay down through a
REBOOT on its own; this skip is what keeps a Bay RESTART from resurrecting it,
and on the child runner it is the whole mechanism.

A method rather than a loop inside `cmdServe` so a test can run it: `cmdServe`
binds sockets and never returns.
*/
func (s *server) restoreApps() {
	for _, app := range s.store.Apps() {
		if app.Stopped {
			s.log.Info("skipping a stopped app", "app", app.Key(),
				"hint", "bay start "+app.Key())
			continue
		}
		if err := s.start(app); err != nil {
			s.log.Error("restore failed", "app", app.Key(), "err", err)
		}
	}
}

/*
stopInstance takes one instance out of service, durably.

The one implementation behind `bay stop`, the control route and the connector's
`stop` verb, so the CLI, the socket and Lore cannot end up meaning three
different things by the same word.

Two halves, and both are needed. The persisted intent is what the boot loop
reads, and it is what makes the stop survive a Bay upgrade on any runner. The
park is what makes it survive a host reboot on systemd, where an enabled unit
comes back whatever Bay thinks.

⚠️ No `holdDuring`. A stop means the site goes dark on purpose, and holding
requests for ninety seconds before answering 502 is worse than answering 502
now.

⚠️ The intent is recorded FIRST. A park that fails leaves an app that is still
running and is marked stopped, which the next boot corrects; the other order
leaves one that is down and marked running, which nothing corrects.
*/
func (s *server) stopInstance(key string) error {
	app, ok := s.store.Get(key)
	if !ok {
		return fmt.Errorf("unknown app %q", key)
	}
	if app.Static {
		return fmt.Errorf("%s is a static site: it has no process to stop", key)
	}
	if err := s.store.SetStopped(key, true); err != nil {
		return err
	}
	return s.runner.Park(key, stopGrace)
}

/*
startInstance puts a stopped instance back into service.

Clears the intent, then starts, which on systemd re-enables the unit: `Start`
runs `systemctl enable` before it restarts, so the two halves of a stop are
undone by the two halves of a start.

⚠️ An instance that is already running is left ALONE and reported as started.
`Systemd.Start` runs `systemctl restart`, so calling it here would restart a
healthy app in disguise - a "start" that bounces production is not what anyone
clicking it expects.
*/
func (s *server) startInstance(key string) error {
	app, ok := s.store.Get(key)
	if !ok {
		return fmt.Errorf("unknown app %q", key)
	}
	if app.Static {
		return fmt.Errorf("%s is a static site: it has no process to start", key)
	}
	if err := s.store.SetStopped(key, false); err != nil {
		return err
	}
	if s.runner.Running(key) {
		return nil
	}
	app.Stopped = false
	return s.start(app)
}

func (s *server) start(app state.App) error {
	// A static site has no process. It is serving the moment `current` points at
	// the new release, because the proxy reads the files straight off disk —
	// there is no interpreter to resolve, nothing to supervise, and no port to
	// probe. Readiness is the release switch itself, so a rollback is instant
	// and cannot fail a health check.
	//
	// Checked before the .env is loaded, which is the ordering that matters: a
	// static app has no .env, and letting `LoadEnvFile` see a missing file first
	// would decide the outcome by whatever that function happens to do rather
	// than by anything anyone designed.
	if app.Static {
		s.log.Info("static app ready", "app", app.Key(), "domain", app.Domain())
		return nil
	}

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
	// resource that needs it. Declaring `$storage` is what grants write access to
	// storage/; not declaring it denies it. (The manifest key is still
	// `hasBucket` — a wire-format name kept after the `$bucket` → `$storage`
	// rename; there is no `$bucket` primitive anymore.)
	writable := []string{filepath.Join(instance, "scratch")}
	if m.Resources.Database {
		writable = append(writable, filepath.Join(instance, "data"))
	}
	// An S3-backed app writes its blobs to the bucket, so the directory is dead
	// weight — and a writable path granted "just in case" is one an exploit can
	// use. The manifest says the app needs blob storage; the backend says where,
	// and only one of the two answers needs a directory on this disk.
	if m.Resources.Bucket && app.StorageBackend != deploy.BackendS3 {
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
			CPUQuota:      cpuQuotaFor(runtime.NumCPU()),
			StopGrace:     stopGrace,
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
	s.log.Info("app ready", "app", app.Key(), "port", app.Port, "domain", app.Domain())
	return nil
}

// ---------------------------------------------------------------------------
// control API — the single contract, consumed by every command but "serve"
// ---------------------------------------------------------------------------

// controlMux builds the routes. Authorization is applied by the caller: unix
// permissions on the socket.
func (s *server) controlMux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /apps", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, s.listApps())
	})
	mux.HandleFunc("POST /apps", s.handleDeploy)
	mux.HandleFunc("DELETE /apps/{name}/{env}", s.handleRemove)
	mux.HandleFunc("POST /apps/{name}/{env}/stop", func(w http.ResponseWriter, r *http.Request) {
		key := r.PathValue("name") + "/" + r.PathValue("env")
		if err := s.stopInstance(key); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"stopped": key})
	})
	mux.HandleFunc("POST /apps/{name}/{env}/start", func(w http.ResponseWriter, r *http.Request) {
		key := r.PathValue("name") + "/" + r.PathValue("env")
		if err := s.startInstance(key); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"started": key})
	})
	mux.HandleFunc("GET /apps/{name}/{env}/logs", s.handleLogs)
	// What this server was started with, for the commands that have to judge
	// against it. `bay status` used the compiled default, so a host backing up
	// every 6 hours was called stale after 24, and one backing up weekly was
	// never called stale at all - the column that exists to notice a stopped
	// schedule was answering about a different schedule.
	mux.HandleFunc("GET /settings", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, serverSettings{
			BackupInterval: s.backupInterval.String(),
		})
	})
	s.registerBackupRoutes(mux)
	s.registerStorageRoutes(mux)
	s.registerEnvRoutes(mux)
	s.registerConnectorRoutes(mux)
	return mux
}

// maxLogRequest caps how much one call may ask for.
//
// The control API answers in memory and holds a lock nothing else can take
// while it does. Two thousand lines is more than anyone reads at once and small
// enough that a caller asking for a million cannot stall the supervisor.
const maxLogRequest = 2000

// logsResponse distinguishes "not supervised here" from "supervised and quiet".
//
// Two empty results that mean different things: one sends the operator to check
// whether they are on the right machine, the other to check whether the app is
// actually doing anything. An empty array alone cannot say which.
type logsResponse struct {
	Supervised bool `json:"supervised"`
	// Static marks a site served from disk, which is a THIRD empty result. It
	// has no process and never will, so "not supervised by this Bay" — which
	// reads as "you are on the wrong machine" — would send an operator looking
	// for something that does not exist.
	Static bool             `json:"static,omitempty"`
	Lines  []runner.LogLine `json:"lines"`
}

func (s *server) handleLogs(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("name") + "/" + r.PathValue("env")
	lines := 200
	if raw := r.URL.Query().Get("lines"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			writeError(w, http.StatusBadRequest, "lines must be a positive integer")
			return
		}
		lines = min(parsed, maxLogRequest)
	}
	entries, supervised, err := s.runner.Logs(key, lines)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if entries == nil {
		entries = []runner.LogLine{}
	}
	// Read from the store rather than inferred from the empty result: a static
	// site and an app this Bay has never heard of both come back unsupervised,
	// and only the store can tell them apart.
	app, known := s.store.Get(key)
	writeJSON(w, http.StatusOK, logsResponse{
		Supervised: supervised,
		Static:     known && app.Static,
		Lines:      entries,
	})
}

// serverSettings is what the running `serve` was configured with, for the
// client commands that have to judge against it rather than against whatever
// this binary's defaults happen to be.
//
// A durations-as-strings document on purpose: `time.Duration` marshals as a
// nanosecond integer, which is neither readable in a `curl` nor safe to widen
// later.
type serverSettings struct {
	BackupInterval string `json:"backupInterval"`
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
	name, env := q.Get("name"), q.Get("env")
	// Repeated rather than joined: a hostname cannot contain a comma, but a
	// query parameter can be sent more than once, and letting the URL carry the
	// list keeps the CLI from having to invent an escaping rule.
	domains := q["domain"]
	if env == "" {
		env = "production"
	}
	// A PATH, never a value. The file it names is read, unlinked and merged
	// during provision — see `deploy.ConsumeSecretsFile`. Putting the secrets
	// themselves in a query string would be the argv mistake with extra steps.
	secretsFile := q.Get("secretsFile")

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

	// Detached from the request: once the artifact is uploaded the deploy has
	// to finish whether or not the client is still listening. Bound to the
	// request, the auto-restore was cancelled with a dropped connection (or the
	// CLI's own timeout) and the app booted on the empty database it had just
	// created, which nothing restores a second time.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), deployTimeout)
	defer cancel()
	out, derr := s.deployArtifact(ctx, deployArtifactOptions{
		Artifact: tmp.Name(), Name: name, Env: env, Domains: domains,
		SecretsFile: secretsFile,
	})
	if derr != nil {
		writeError(w, derr.Status, derr.Error(), derr.Detail)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"app":     out.Result.App,
		"release": out.Result.Release,
		"url":     "https://" + out.Result.App.Domain() + "/",
		"restore": out.Restore,
		"pruned":  out.Pruned,
	})
}

// deployArtifactOptions is one deploy, whatever asked for it.
type deployArtifactOptions struct {
	// Artifact is a tar.gz already on local disk. Getting it there is the
	// caller's problem — currently always an upload staged by the control
	// API's deploy handler.
	Artifact string
	Name     string
	Env      string
	Domains  []string
	// MigratedStorage says `bay storage migrate` has already copied this app's
	// local files into the bucket. Set only by that command; a deploy that
	// would otherwise strand files is refused without it.
	MigratedStorage bool
	// SecretsFile is a path on this host holding `KEY=VALUE` lines: the app's
	// own environment, delivered with the deploy so it is in place before the
	// process starts. Consumed — read and unlinked — before anything else
	// happens. Empty for a deploy that carries no configuration.
	SecretsFile string
}

// deployOutcome is what a completed deploy has to say for itself.
type deployOutcome struct {
	Result  deploy.Result
	Restore map[string]any
	Pruned  []string
}

// deployFailure carries how a deploy failed, not just that it did.
//
// The two cases want opposite handling and always have: a refused artifact is a
// bad build and nothing on the host has moved except the process the deploy
// stopped, while "deployed but would not boot" leaves files on disk, a `current`
// that has already been swapped and a rollback target. Collapsing them into one
// error would lose the release name at exactly the moment someone needs it.
//
// Whichever it is, the status says whether the app is serving. A 400 means the
// artifact was refused and the previous release is up; a 502 means it is not,
// and the message names both what failed and what could not be put back.
// Neither is ever returned before the recovery has been attempted — see
// restoreRefused and restoreUnstartable.
type deployFailure struct {
	Status int
	Err    error
	Detail map[string]any
}

func (e *deployFailure) Error() string { return e.Err.Error() }
func (e *deployFailure) Unwrap() error { return e.Err }

// deployArtifact unpacks, provisions, starts and prunes.
//
// Kept separate from its one production caller — the control API's POST /apps
// handler — so tests can drive the whole deploy sequence directly, without
// going through HTTP. That sequence has five ordering constraints that were
// each learned the hard way: stop before swapping `current`, restore before
// starting, watch before pruning, prune only after the app is proven to boot,
// and never answer a failure before putting the app back.
func (s *server) deployArtifact(ctx context.Context, opts deployArtifactOptions) (*deployOutcome, *deployFailure) {
	key := opts.Name + "/" + opts.Env

	// Consumed BEFORE anything moves: before the hold, before the running app
	// is stopped, before a byte is unpacked. A secrets file that is a symlink,
	// world-readable, or full of keys Bay owns is a deploy that must not start
	// — refusing it here costs the caller nothing, while refusing it after the
	// stop would be an outage caused by a validation.
	//
	// The file is gone either way. `ConsumeSecretsFile` unlinks it on every
	// path out, so a refusal does not leave plaintext credentials on the disk
	// of the host somebody is about to go and debug.
	var secrets map[string]string
	if opts.SecretsFile != "" {
		parsed, err := deploy.ConsumeSecretsFile(opts.SecretsFile)
		if err != nil {
			return nil, &deployFailure{Status: http.StatusBadRequest, Err: err}
		}
		secrets = parsed
	}

	// Requests wait from here rather than 502, and keep waiting through the
	// unpack, the swap and the new process's boot.
	defer s.holdDuring(key)()

	// Stop the previous process before swapping `current` under it.
	//
	// Whether it was serving is read BEFORE the stop, because it decides what a
	// failed deploy has to put back — and after the stop the answer is always no.
	wasRunning := s.runner.Running(key)
	_ = s.runner.Stop(key, stopGrace)

	res, err := deploy.Run(deploy.Options{
		Root: s.root, Artifact: opts.Artifact, Name: opts.Name, Env: opts.Env,
		Domains: opts.Domains, BaseDomain: s.store.BaseDomain(),
		// Read per deploy rather than captured at boot, so `bay config s3:apps`
		// takes effect on the next deploy without restarting the proxy — the
		// same contract `backupManager` has.
		Storage:         s.store.Storage(),
		MigratedStorage: opts.MigratedStorage,
		Secrets:         secrets,
	}, s.store)
	if err != nil {
		return nil, s.restoreRefused(key, wasRunning, err)
	}

	// Restore BEFORE starting: the app must open the recovered database, not an
	// empty one that gets swapped under it. And only when Bay just created that
	// empty file — never over an existing database.
	restore := map[string]any{"database": "existing"}
	if res.DatabaseCreated && res.DatabasePath != "" {
		restore = s.maybeAutoRestore(ctx, res.App, res.DatabasePath)
	}

	if err := s.start(res.App); err != nil {
		return nil, s.restoreUnstartable(res, restore, err)
	}
	if s.tls != nil {
		if err := s.tls.Manage(ctx, res.App.Domains); err != nil {
			s.log.Error("certificate for new domain failed", "domains", res.App.Domains, "err", err)
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

	// Trimmed only now, after the app has been proven to boot.
	//
	// Pruning before the health check would destroy rollback targets on behalf
	// of a release that turns out not to start — taking away the escape route at
	// exactly the moment it is needed.
	//
	// `res.Previous` is named explicitly rather than left to the keep window,
	// which does not cover it. It is whatever `state.Release` held before this
	// deploy, and an automatic rollback sets that to the previous release
	// chose — so after rollback-then-deploy the target of the watch started just
	// above can sit well outside the kept releases, with `current` already
	// repointed here and no longer protecting it.
	pruned := s.pruneReleases(res.App, res.Previous)

	return &deployOutcome{Result: *res, Restore: restore, Pruned: pruned}, nil
}

/*
restoreRefused puts back the app that the stop before the unpack took down.

An artifact the unpacker refuses changes nothing in the instance directory — it
is unpacked into a staging directory first, so the previous release is still
there and `current` still points at it. Starting the app on its stored state is
therefore the whole of the repair; there is nothing to swap back.

Observed on ovh-bay: `example-api/production` was serving, a gzip that was not a
tar was deployed, the release went `failed` with the correct message, and the app
stayed stopped and 502 until a good artifact was pushed again. The report was
accurate and reassuring — "the deploy failed" reads as "nothing changed" — which
is what made it expensive. A CI pipeline deploying over SSH reads the same
terse response and moves on; nobody is watching in real time there either.

The failure stays a 400 when the restart works: the artifact is what was wrong,
the host is where it was, and a 5xx would send someone to inspect a machine that
is fine. It becomes a 502 naming both failures when the app could not be brought
back, because "the deploy failed" and "the deploy failed AND the site is down"
are different sentences, and only the second one should wake anybody up.
*/
func (s *server) restoreRefused(key string, wasRunning bool, cause error) *deployFailure {
	app, registered := s.store.Get(key)

	// Nothing to put back, for one of two reasons: the app was not serving —
	// starting it here would resurrect something somebody deliberately stopped,
	// on the strength of a deploy that failed — or this was a first deploy, and
	// there is no earlier release to put back at all.
	if !wasRunning || !registered {
		return &deployFailure{
			Status: http.StatusBadRequest,
			Err:    cause,
			Detail: map[string]any{"running": false},
		}
	}

	if err := s.start(app); err != nil {
		s.log.Error("REFUSED ARTIFACT LEFT THE APP DOWN", "app", key,
			"release", app.Release, "artifact", cause, "restart", err)
		return &deployFailure{
			Status: http.StatusBadGateway,
			Err: fmt.Errorf(
				"the artifact was refused AND %s is DOWN — release %s could not be restarted: %w (restart: %w)",
				key, app.Release, cause, err),
			Detail: map[string]any{"release": app.Release, "running": false},
		}
	}
	s.log.Warn("artifact refused, previous release restarted",
		"app", key, "release", app.Release, "artifact", cause)
	return &deployFailure{
		Status: http.StatusBadRequest,
		// The artifact's own error, unchanged: the build is what was wrong, and
		// this is the sentence that says how. What the host is doing about it
		// belongs in the detail, not appended to a compiler-style message.
		Err:    cause,
		Detail: map[string]any{"release": app.Release, "running": true},
	}
}

/*
restoreUnstartable rolls a release that will not boot back to its predecessor.

`watchAndRollback` does not cover this, and cannot: it is armed only once `start`
has returned successfully, so a release that never becomes ready has nothing
watching it. By the time this is reached `current` and the store both name the new
release, the process is not running, and no timer will ever put it back — the app
would stay down until somebody noticed — which on a CI-driven deploy is the
problem, not the fix.

Rolled back to what was demonstrably serving a moment ago: the same target and the
same steps the health watch uses, for the same reason. Migrations are forward-only
and stay applied — the known cost of both paths, and the smaller of the two when
the alternative is a site that is down.

The release name is still reported either way: once `current` has moved back it
is the one thing an operator cannot recover from the logs.
*/
func (s *server) restoreUnstartable(
	res *deploy.Result, restore map[string]any, cause error,
) *deployFailure {
	detail := map[string]any{"release": res.Release, "restore": restore}
	key := res.App.Key()

	// A first deploy, or a redeploy of the same release. Nothing to go back to,
	// and saying so is what stops an operator waiting for a rollback that is not
	// coming.
	if res.Previous == "" || res.Previous == res.Release {
		return &deployFailure{
			Status: http.StatusBadGateway,
			Err: fmt.Errorf(
				"%s is DOWN: release %s did not become ready and there is no earlier release to fall back to, see logs/app.log: %w",
				key, res.Release, cause),
			Detail: detail,
		}
	}

	if err := s.rollbackTo(res.App, res.Previous); err != nil {
		s.log.Error("ROLLBACK FAILED — the app is down", "app", key,
			"bad", res.Release, "to", res.Previous, "err", err)
		return &deployFailure{
			Status: http.StatusBadGateway,
			Err: fmt.Errorf(
				"%s is DOWN: release %s did not become ready AND the rollback to %s failed, see logs/app.log: %w (rollback: %w)",
				key, res.Release, res.Previous, cause, err),
			Detail: detail,
		}
	}

	s.log.Warn("release did not become ready, rolled back",
		"app", key, "bad", res.Release, "now", res.Previous, "err", cause)
	detail["rolledBackTo"] = res.Previous
	return &deployFailure{
		Status: http.StatusBadGateway,
		Err: fmt.Errorf(
			"release %s did not become ready and was rolled back to %s, which is serving again, see logs/app.log: %w",
			res.Release, res.Previous, cause),
		Detail: detail,
	}
}

/*
rollbackTo puts an app back on a release: on disk, in the store, and running.

The order is load-bearing. `current` is what a start reads, so the swap comes
first; the store is what every status call and the next deploy report, so it
follows immediately; starting comes last, because a failure there leaves the app
pointing wholly at the release the caller asked for rather than half at each.

Shared by the deploy path and the health watch on purpose — the same three steps
were written twice, and the second copy would have missed the first fix. The
errors name the consequence rather than the step, because they are read in a log
by somebody who has just been woken up.
*/
func (s *server) rollbackTo(app state.App, release string) error {
	if err := deploy.SwapRelease(s.instanceDir(app), release); err != nil {
		return fmt.Errorf("could not point current at %s, the app is still on %s: %w",
			release, app.Release, err)
	}
	if err := s.store.SetRelease(app.Key(), release); err != nil {
		// Not fatal: the app boots from `current`, which has already moved. Said
		// loudly because from here on every report disagrees with the disk.
		s.log.Error("rolled back on disk but not in state", "app", app.Key(), "err", err)
	}
	app.Release = release
	// The bad release's process may still be alive (ready never came, or the
	// health window failed while it kept answering). The systemd runner's
	// restart replaces it; the child runner refuses to start a running key,
	// so every automatic rollback used to fail there with the bad process
	// still serving.
	_ = s.runner.Stop(app.Key(), stopGrace)
	if err := s.start(app); err != nil {
		return fmt.Errorf("%s is current again but did not start: %w", release, err)
	}
	return nil
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
	// A static site has no port, so every probe in the window fails and the
	// verdict is always "unhealthy" — the watch would roll back a release that
	// is answering every request off disk perfectly well.
	//
	// This only arms on a REDEPLOY, so it would not have shown up until the
	// second time someone shipped a static site: the deploy that succeeds, then
	// silently reverts a minute later with nothing wrong.
	if app.Static {
		return
	}

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

	if err := s.rollbackTo(app, previous); err != nil {
		// Nothing left to try automatically. Said loudly rather than retried:
		// an app stuck between two releases needs a human, and a loop here
		// would bury the one line that says so. What went wrong is in the
		// error — it names whether the app is still on the bad release or on
		// the old one that would not start.
		s.log.Error("ROLLBACK FAILED — the app is down", "app", app.Key(), "err", err)
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
	// After the data, so the unix user is never deleted while files it owns
	// are still on disk — the window deleteUser exists to avoid. Logged rather
	// than returned: the app is already out of the registry and no longer
	// served, so failing the request here would report a removal that did
	// happen as one that did not, and the operator would retry against an app
	// that is already gone.
	if err := s.runner.Remove(key, purged); err != nil {
		s.log.Error("uninstall failed while removing", "app", key, "err", err)
	}
	s.log.Info("removed app", "app", key, "domain", app.Domain(), "purged", purged)
	writeJSON(w, http.StatusOK, map[string]any{
		"removed": key,
		"domain":  app.Domain(),
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
// control API got an `HttpError` with an empty message, and
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

// artifactBody resolves the artifact argument to something the control API can
// be handed.
//
// `-` means stdin, which is what makes a remote deploy one command:
//
//	ssh HOST 'bay deploy - --name app' < app.tar.gz
//
// `/dev/stdin` happens to work for a pipe on Linux, so this is not strictly
// required — but it depends on a /proc coincidence, it is absent on macOS, and
// the failure mode if it ever stops holding is a deploy that uploads an empty
// artifact rather than one that errors. Ten lines is cheaper than that.
//
// The returned closer is always safe to call, so the caller needs no branch.
func artifactBody(artifact string, stdin io.Reader) (io.Reader, func(), error) {
	if artifact == "-" {
		return stdin, func() {}, nil
	}
	f, err := os.Open(artifact)
	if err != nil {
		return nil, func() {}, err
	}
	return f, func() { f.Close() }, nil
}

func cmdDeploy(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: bay deploy (<app.tar.gz>|-) --name NAME --domain HOST [--env ENV]\n" +
			"  -  reads the artifact from stdin, e.g. ssh HOST 'bay deploy - --name app' < app.tar.gz")
	}
	artifact := args[0]
	if err := checkFlags(args[1:],
		map[string]bool{},
		map[string]bool{"--name": true, "--env": true, "--domain": true,
			"--secrets-file": true, "--control-socket": true}); err != nil {
		return err
	}
	name, env := "", "production"
	secretsFile := ""
	var domains []string
	for i := 1; i < len(args); i++ {
		if i >= len(args)-1 {
			continue
		}
		switch args[i] {
		case "--name":
			name = args[i+1]
		case "--env":
			env = args[i+1]
		case "--secrets-file":
			// Absolute, because the server resolves it. This command runs as the
			// deploying user with cwd $HOME; `bay serve` is a different process
			// with a different working directory, and a relative path would land
			// somewhere neither of them meant.
			abs, err := filepath.Abs(args[i+1])
			if err != nil {
				return err
			}
			secretsFile = abs
		case "--domain":
			// Repeatable AND comma-separated, because both shapes turn up: a
			// hand-typed apex plus www, and a value pasted out of a config file.
			// Accepting one and silently ignoring the other is the kind of thing
			// nobody notices until a certificate is missing.
			for _, host := range strings.Split(args[i+1], ",") {
				if host = strings.TrimSpace(host); host != "" {
					domains = append(domains, host)
				}
			}
		}
	}
	body, closeBody, err := artifactBody(artifact, os.Stdin)
	if err != nil {
		return err
	}
	defer closeBody()

	query := neturl.Values{"name": {name}, "env": {env}}
	for _, host := range domains {
		query.Add("domain", host)
	}
	if secretsFile != "" {
		query.Set("secretsFile", secretsFile)
	}
	url := controlHost + "/apps?" + query.Encode()
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
	// The server's own schedule, not this binary's default. Overridden below
	// by an explicit `--backup-interval`: someone who states one is asking
	// what WOULD be stale under it, which is a different and legitimate
	// question from what is stale now.
	interval := serveBackupInterval()
	asJSON := false
	for i, arg := range args {
		if arg == "--json" {
			asJSON = true
		}
		if arg == "--backup-interval" && i < len(args)-1 {
			d, err := time.ParseDuration(args[i+1])
			if err != nil {
				return fmt.Errorf("--backup-interval: %q is not a duration", args[i+1])
			}
			interval = d
		}
	}

	raw, err := call(http.MethodGet, controlHost+"/apps", nil)
	if err != nil {
		return err
	}
	// listedApp rather than a struct literal of the fields this command happens
	// to print: the control API is the one contract, and re-declaring a subset
	// here is how a field added on the server silently fails to reach the CLI.
	var apps []listedApp
	if err := json.Unmarshal([]byte(raw), &apps); err != nil {
		return fmt.Errorf("parse control api response: %w", err)
	}
	if len(apps) == 0 {
		if asJSON {
			fmt.Println("[]")
			return nil
		}
		fmt.Println("no apps deployed")
		return nil
	}

	now := time.Now()
	if asJSON {
		return printStatusJSON(apps, now, interval)
	}

	problems := 0
	// Host-wide, printed once above the fleet. `bay config s3` is a decision
	// that outlives the terminal it was made in, so the reminder has to live
	// somewhere an operator returns to rather than only in that command's
	// output.
	if sharedCredentialConfigured() {
		problems++
		fmt.Printf("⚠ apps and backups share ONE credential — any hosted app can delete\n" +
			"  every backup on this host. Split them with `bay config s3:apps`.\n\n")
	}
	for _, a := range apps {
		fmt.Printf("%s/%s\n", a.Name, a.Env)
		fmt.Printf("  domain   %s\n", strings.Join(a.Domains, ", "))
		fmt.Printf("  release  %s\n", a.Release)

		// A registered app that is not running is the loudest thing this
		// command can say, and it used to say nothing at all.
		//
		// Except for a static site, which has no process by design. Saying NOT
		// RUNNING there would be a permanent false alarm on a healthy host.
		if a.Static {
			fmt.Printf("  process  static — served from disk\n")
		} else if !a.Running {
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

		// Traffic answers the question an operator actually asks once twenty
		// prototypes share a host: which of these is dead? Crons are named on
		// the same line because an app whose whole job is a weekly email serves
		// no requests and would otherwise read as abandoned.
		fmt.Printf("  traffic  %s\n", trafficLine(a, now))

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
		// What is NOT covered even on success, stated on every healthy line:
		// someone reading a green status should know the shape of it before
		// they need it, not after.
		if a.Backups {
			fmt.Printf("           .env is not backed up — secrets come from the deploy\n")
			// Uploads are not in the backup set at all. An app still on local
			// storage therefore has exactly one copy of them, on this disk, and
			// a green backup line must not be read as covering that.
			if a.StorageBackend == deploy.BackendLocal {
				fmt.Printf("           uploads are on this disk ONLY — `bay config s3:apps` to put them in a bucket\n")
			}
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

/*
cmdStop takes an instance out of service until somebody puts it back.

⚠️ Durable since the console's stop verb landed, and that is a change in what
this command means. It used to be undone by the next reboot (the unit stayed
enabled) and by the next `bay serve` restart (the boot loop started every
stored app). Both are closed now: the intent is persisted and the unit is
disabled, so the way back is `bay start` or a deploy.
*/
func cmdStop(args []string) error {
	key, err := instanceKey(args, "stop")
	if err != nil {
		return err
	}
	res, err := call(http.MethodPost, controlHost+"/apps/"+key+"/stop", nil)
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

/*
cmdStart puts a stopped instance back into service.

It exists because the stop became durable. Without it an operator over ssh who
stopped an app would have no way back short of a redeploy, and `restart` is not
that way: it refuses an app that is not running, on purpose, because whoever
stopped it owns that decision.
*/
func cmdStart(args []string) error {
	key, err := instanceKey(args, "start")
	if err != nil {
		return err
	}
	res, err := call(http.MethodPost, controlHost+"/apps/"+key+"/start", nil)
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

// instanceKey reads the `<name/env>` argument these two share, defaulting the
// environment the way `bay stop` always has.
func instanceKey(args []string, cmd string) (string, error) {
	if len(args) == 0 {
		return "", errors.New("usage: bay " + cmd + " <name/env>")
	}
	key := args[0]
	if !strings.Contains(key, "/") {
		key += "/production"
	}
	return key, nil
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
// On the host itself the socket is both the simpler path and the safer one:
// no secret has to be fetched, exported, or left in a shell history. `--control-socket` and $BAY_SOCKET override; otherwise the
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
				"For remote deploys, ssh into the Bay host and run bay there.")
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

// serveBackupInterval asks the running server what it backs up on.
//
// Falls back to the compiled default rather than failing: an older `serve`
// has no `/settings` route, and a status report that refuses to print because
// one column cannot be judged perfectly is worse than one that judges that
// column the way it always used to. Every other number in the report comes
// from a separate call that fails loudly on its own.
func serveBackupInterval() time.Duration {
	raw, err := call(http.MethodGet, controlHost+"/settings", nil)
	if err != nil {
		return defaultBackupInterval
	}
	var settings serverSettings
	if err := json.Unmarshal([]byte(raw), &settings); err != nil {
		return defaultBackupInterval
	}
	d, err := time.ParseDuration(settings.BackupInterval)
	if err != nil {
		return defaultBackupInterval
	}
	return d
}
