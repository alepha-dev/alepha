// Package manifest reads the `dist/manifest.json` produced by `alepha build`.
//
// The manifest is the contract between the build and Bay: it declares what the
// app needs, so Bay never has to execute app code to find out.
//
// It is deliberately the SAME file the framework already emits for every other
// deploy consumer (`alepha platform up --prebuilt`, Alepha Rocket) — not a
// Bay-specific one. A second, hand-written manifest would reintroduce exactly
// the code↔infra drift that deriving it is supposed to make impossible:
// declaring `$repository` is what sets `hasDatabase`, and nobody has to
// remember to say so twice.
package manifest

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// RuntimeStatic marks an artifact with no entry point to spawn.
//
// It sits in the same `runtime` field as node and bun because that field is
// what an older Bay switches on: meeting an unknown value it refuses the deploy
// by name. A separate `kind` field would be IGNORED by an older Bay — unknown
// fields are dropped on purpose so a newer build never breaks it — which would
// leave it reading `runtime: node`, spawning node against a directory with no
// index.js, and reporting only "never became ready".
const RuntimeStatic = "static"

// Path is where the manifest lives inside an unpacked artifact.
//
// Hardcoded rather than derived from the manifest's own `entry` field, which
// would be circular.
//
// ⚠️ **At the archive ROOT, not inside `dist/`.** The artifact used to wrap
// everything in a `dist/` directory; it now unpacks to `./public`, `./server`,
// `./index.<runtime>.js`, `./migrations` and `./manifest.json` at the top. No
// compatibility alias is carried: Bay ships this first, and every artifact
// produced afterwards has the new shape. An older artifact is refused with a
// message naming a redeploy as the fix, in `load` below.
const Path = "manifest.json"

// PublicDir is where an unpacked artifact keeps the files served straight from
// disk: the client bundle, the prerendered HTML, `_headers`.
//
// It moved with the rest when the archive root became the contents (it was
// `dist/public`), and it is named here rather than composed at each of the four
// call sites — the deployer's `_headers` check, the proxy's static root, the
// proxy's header lookup — because a rename that reaches three of four is a
// static site that serves nothing with nobody able to say which layer lost it.
const PublicDir = "public"

// resources mirrors the `resources` object of the framework's BuildManifest.
//
// The `has` prefix is the framework's wire format; Bay exposes the shorter
// names below because `m.Resources.Database` reads better at the call sites
// that decide what to provision.
type resources struct {
	HasDatabase bool `json:"hasDatabase"`
	HasBucket   bool `json:"hasBucket"`
	HasKV       bool `json:"hasKV"`
	HasQueue    bool `json:"hasQueue"`
}

// buildManifest is the on-disk shape, mirroring the framework's `BuildManifest`
// interface. Only the fields Bay acts on are declared; the rest (environments,
// tenancy, websocketPaths, email, env) belongs to other consumers and is
// ignored rather than rejected, so a newer build never breaks an older Bay.
type buildManifest struct {
	Version        int       `json:"version"`
	Project        string    `json:"project"`
	Runtime        string    `json:"runtime"`
	RuntimeVersion string    `json:"runtimeVersion"`
	Entry          string    `json:"entry"`
	Runtimes       []slice   `json:"runtimes"`
	Resources      resources `json:"resources"`
	Crons          []string  `json:"crons"`
}

// slice is one server slice of a multi-runtime artifact.
//
// An artifact may carry several: one linked for node, one for workerd, one for
// bun. Each names its runtime and the file to spawn, relative to the archive
// root.
type slice struct {
	Runtime string `json:"runtime"`
	Entry   string `json:"entry"`
}

// runnable reports whether Bay can spawn this runtime at all.
//
// workerd cannot: it is Cloudflare's, and a bundle resolved against its export
// conditions has no self-hosted entry point. static spawns nothing by
// definition. So the two Bay can run are node and bun, and `pick` below walks
// the declared order looking for one of them.
func runnable(runtime string) bool {
	return runtime == "node" || runtime == "bun"
}

// pick chooses the slice Bay will run, in DECLARED ORDER.
//
// ⚠️ **The first runnable one wins, and Bay applies no preference of its own.**
// `["node", "bun"]` runs node and `["bun", "node"]` runs bun, from the same two
// slices: the build's declared order is the decision, and reordering here
// would silently change which runtime an app is deployed on. It is the same
// rule the build uses to pick the primary, which is what makes the scalar
// `runtime` (always `runtimes[0]`) and this choice incapable of disagreeing.
//
// When nothing declared is runnable, the FIRST slice is returned anyway so
// `validate` can refuse it by name — a workerd-only artifact should say
// "built for Cloudflare Workers", not "no runnable slice".
func (b *buildManifest) pick() (runtime, entry string) {
	// Nothing to spawn: the slice search would be answering a question a static
	// site does not ask.
	if b.Runtime == RuntimeStatic || len(b.Runtimes) == 0 {
		return b.Runtime, b.Entry
	}
	for _, s := range b.Runtimes {
		if runnable(s.Runtime) {
			return s.Runtime, s.Entry
		}
	}
	return b.Runtimes[0].Runtime, b.Runtimes[0].Entry
}

// Resources is what Bay acts on: each true value becomes a directory the app is
// allowed to write to, and nothing else is.
type Resources struct {
	Database bool
	Bucket   bool
	KV       bool
	Queue    bool
}

// Manifest is what Bay reads before touching anything else.
type Manifest struct {
	// Name identifies the app. A property of the artifact, derived by the build
	// — never a deployment choice, which is why the domain is composed from it
	// rather than written by hand.
	Name           string
	Runtime        string // "node" | "bun" | "static"
	RuntimeVersion string // MAJOR only, e.g. "26"
	// Entry is the file to spawn, relative to the release root — e.g.
	// `index.node.js`. It used to be a directory (`dist`, resolved through its
	// `main`) and has no default anymore: the archive root is the contents, so
	// a default of `dist` would name a directory that is not there.
	Entry     string
	Resources Resources
	Cron      []string
}

// LoadFromRelease reads and validates the manifest of an unpacked release.
//
// The ONLY way in. `load` is unexported so no caller outside this package can
// compose the manifest's path by hand — one that did was left reading the old
// pre-`dist/` location after the move, and neither the compiler nor a passing
// test suite noticed. Making the path uncomposable closes the class.
func LoadFromRelease(releaseDir string) (*Manifest, error) {
	return load(filepath.Join(releaseDir, filepath.FromSlash(Path)))
}

func load(path string) (*Manifest, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		// A release unpacked by an older Bay carries a hand-written manifest at
		// the archive root instead. Say so: the alternative message is "read
		// manifest: no such file", which on a Bay restart shows up as every app
		// failing to come back with no hint that a redeploy is the fix.
		if os.IsNotExist(err) {
			legacy := filepath.Join(filepath.Dir(path), "dist", "manifest.json")
			if _, legacyErr := os.Stat(legacy); legacyErr == nil {
				return nil, fmt.Errorf(
					"%s is missing, but dist/manifest.json is present: this release predates the flat artifact layout, where the archive root is the contents rather than a dist/ wrapper; redeploy the app to migrate it",
					Path,
				)
			}
		}
		return nil, fmt.Errorf("read manifest: %w", err)
	}
	var b buildManifest
	if err := json.Unmarshal(raw, &b); err != nil {
		return nil, fmt.Errorf("parse manifest: %w", err)
	}
	runtime, entry := b.pick()
	m := &Manifest{
		Name:           b.Project,
		Runtime:        runtime,
		RuntimeVersion: b.RuntimeVersion,
		Entry:          entry,
		Resources: Resources{
			Database: b.Resources.HasDatabase,
			Bucket:   b.Resources.HasBucket,
			KV:       b.Resources.HasKV,
			Queue:    b.Resources.HasQueue,
		},
		Cron: b.Crons,
	}
	m.applyDefaults()
	return m, m.validate()
}

func (m *Manifest) applyDefaults() {
	// Absent in artifacts built before the field existed. Node is what the
	// framework's own build defaults to.
	if m.Runtime == "" {
		m.Runtime = "node"
	}
	// No `Entry` default. `dist` used to be one, because the archive wrapped the
	// build in a `dist/` directory whose `main` resolved the bundle. The archive
	// root is now the contents, so that default would name a directory that does
	// not exist — and spawning `node dist` against it fails as "never became
	// ready", which says nothing about why. `validate` refuses an empty entry
	// instead.
}

func (m *Manifest) validate() error {
	if m.Name == "" {
		return fmt.Errorf("manifest has no project name")
	}
	switch m.Runtime {
	case "node", "bun":
		// The file to spawn. Named here rather than discovered, because the only
		// alternative is guessing, and a guess that lands on the wrong slice
		// starts a workerd bundle under node.
		if m.Entry == "" {
			return fmt.Errorf(
				"artifact declares runtime %q but names no entry file; rebuild it with a current `alepha build`, which writes one per slice",
				m.Runtime,
			)
		}
	case RuntimeStatic:
		// Nothing is spawned, so nothing can open any of these. Refusing names
		// the contradiction while the operator is still watching a deploy;
		// accepting it would provision a database no process ever connects to,
		// and then back it up nightly forever.
		if m.Resources.Database || m.Resources.Bucket || m.Resources.KV || m.Resources.Queue {
			return fmt.Errorf(
				"artifact declares runtime %q but also declares resources; a static site runs no process and cannot use a database, bucket, KV or queue — rebuild with `alepha build --target=bare` if the app needs them",
				m.Runtime,
			)
		}
	case "workerd":
		// Caught here rather than as a crash loop three steps later. A
		// workerd-targeted bundle is resolved against Cloudflare's export
		// conditions and has no node-runnable entry point, so the app would
		// deploy, fail to boot, and report only "never became ready".
		return fmt.Errorf(
			"artifact was built for Cloudflare Workers (runtime %q) and cannot run under a self-hosted runtime; rebuild with `alepha build --target=bare`",
			m.Runtime,
		)
	default:
		return fmt.Errorf("unsupported runtime %q (expected node or bun)", m.Runtime)
	}
	// A runtime pinned to an exact patch defeats central CVE patching: the whole
	// point of Bay owning the runtime is that `bay runtime update` fixes every
	// app at once. Pinning "26.5.0" would force a redeploy per app instead.
	if strings.Count(m.RuntimeVersion, ".") > 0 {
		return fmt.Errorf(
			"runtimeVersion %q pins an exact version; declare a major (e.g. %q) so runtime updates stay central",
			m.RuntimeVersion, strings.SplitN(m.RuntimeVersion, ".", 2)[0],
		)
	}
	return nil
}

// IsStatic reports whether the artifact is a site Bay serves from disk.
//
// A method rather than a `== "static"` at each call site: the runtime string is
// read in the deployer, the supervisor and the proxy, and a comparison spread
// across three packages is one someone eventually writes as `!= "node"`.
func (m *Manifest) IsStatic() bool {
	return m.Runtime == RuntimeStatic
}
