package deploy

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/alepha-dev/bay/internal/naming"
	"github.com/alepha-dev/bay/internal/state"
)

/*
ImageOptions is one deploy of an image app: an app that ships as a container
image instead of an archive (epic E73), the shape Lore records with
`lore artifacts push-image`.
*/
type ImageOptions struct {
	Root       string
	Name       string
	Env        string
	Domains    []string
	BaseDomain string
	// Image is the reference to run, by digest:
	// `registry.example/api:1.4.2@sha256:...`. A tag alone is refused.
	Image string
	// ContainerPort is the port the app listens on inside its image.
	ContainerPort int
	// HealthPath, when set, is an HTTP path that answers 2xx once the app is
	// ready. Empty leaves readiness to the image's own HEALTHCHECK, else to a
	// TCP connect.
	HealthPath string
	// Secrets are merged into the instance's .env, Bay's keys refused.
	Secrets map[string]string
}

// ImageResult is what an image deploy registered.
type ImageResult struct {
	App      state.App
	Previous state.App
	// Redeploy is false on a first deploy, where Previous is empty.
	Redeploy bool
}

/*
RunImage registers an image app: its domain, its host port and its .env.

Nothing is pulled or started here; that is the runner's job, exactly as for an
archive. There is no release directory either: the image IS the release, so
the record carries the reference and a rollback is the previous record.

By digest only. A tag is a name somebody can move, and a deploy that runs
"whatever :latest means today" cannot be rolled back to what it replaced.
*/
func RunImage(opts ImageOptions, store *state.Store) (*ImageResult, error) {
	if !strings.Contains(opts.Image, "@sha256:") {
		return nil, fmt.Errorf("image %q has no digest: an image app deploys by digest (ref@sha256:...), so a rollback can return to exactly what it replaced", opts.Image)
	}
	if opts.ContainerPort <= 0 || opts.ContainerPort > 65535 {
		return nil, fmt.Errorf("an image app needs the port it listens on inside the image (--port)")
	}
	if opts.HealthPath != "" && !strings.HasPrefix(opts.HealthPath, "/") {
		return nil, fmt.Errorf("health path %q must start with /", opts.HealthPath)
	}

	key := opts.Name + "/" + opts.Env
	existing, isRedeploy := store.Get(key)
	if isRedeploy && existing.Image == "" {
		return nil, fmt.Errorf("%s runs an archive; remove it before deploying an image under the same name", key)
	}

	domains := opts.Domains
	if len(domains) == 0 && isRedeploy {
		domains = existing.Domains
	}
	if len(domains) == 0 {
		if opts.BaseDomain == "" {
			return nil, fmt.Errorf("no base domain configured; pass --domain or start bay with --base-domain")
		}
		domains = []string{subdomain(opts.Name, opts.Env) + "." + opts.BaseDomain}
	}
	for _, d := range domains {
		if owner, claimed := store.ClaimedBy(d); claimed && owner != key {
			return nil, fmt.Errorf("domain %s is already served by %s", d, owner)
		}
	}

	instance := filepath.Join(opts.Root, "apps", naming.Instance(opts.Name, opts.Env))
	if err := os.MkdirAll(instance, 0o700); err != nil {
		return nil, err
	}
	envPath := filepath.Join(instance, ".env")
	if _, err := os.Stat(envPath); os.IsNotExist(err) {
		if err := writeEnvFile(envPath, map[string]string{}); err != nil {
			return nil, err
		}
	}
	if len(opts.Secrets) > 0 {
		if _, err := SetEnv(instance, opts.Secrets); err != nil {
			return nil, err
		}
	}

	port := existing.Port
	if !isRedeploy || port == 0 {
		var err error
		if port, err = allocatePort(store.UsedPorts()); err != nil {
			return nil, err
		}
	}

	app := state.App{
		Name:          opts.Name,
		Env:           opts.Env,
		Domains:       domains,
		Release:       shortDigest(opts.Image),
		Port:          port,
		Runtime:       "image",
		Image:         opts.Image,
		ContainerPort: opts.ContainerPort,
		HealthPath:    opts.HealthPath,
	}
	if err := store.Upsert(app); err != nil {
		return nil, err
	}
	registered, _ := store.Get(key)
	return &ImageResult{App: registered, Previous: existing, Redeploy: isRedeploy}, nil
}

// shortDigest names an image release by its digest's first 12 hex characters,
// so `bay status` and the deploy log say which bytes run.
func shortDigest(ref string) string {
	_, digest, _ := strings.Cut(ref, "@sha256:")
	if len(digest) > 12 {
		digest = digest[:12]
	}
	return "sha256:" + digest
}
