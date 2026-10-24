package main

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/manifest"
	"github.com/alepha-dev/bay/internal/runner"
)

// imageFakeRunner is the deploy tests' fake runner, advertising images the
// way the Docker runner does, so `start` takes the container path.
type imageFakeRunner struct {
	*fakeRunner
	pulled []string
}

func (f *imageFakeRunner) EnsureImage(ref string) error {
	f.pulled = append(f.pulled, ref)
	return nil
}

func (f *imageFakeRunner) StartCandidate(runner.Spec) error    { return nil }
func (f *imageFakeRunner) DiscardCandidate(string) error       { return nil }
func (f *imageFakeRunner) Promote(string, time.Duration) error { return nil }

// imageFakeRunner must keep satisfying the interface `start` checks for, or
// these tests would silently exercise the host-binary path instead.
var _ containerRunner = (*imageFakeRunner)(nil)

func TestContainerSpec(t *testing.T) {
	s := runtimesFixture(t, `[{"runtime": "node", "entry": "index.node.js", "runtimeVersion": "26"}]`)
	fake := &imageFakeRunner{fakeRunner: newFakeRunner()}
	s.runner = fake
	app, _ := s.store.Get("api/production")
	instance := filepath.Join(s.root, "apps", "api-production")
	m, err := manifest.LoadFromRelease(filepath.Join(instance, "current"))
	if err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(instance, "data")

	spec, choice, err := s.containerSpec(app, m, map[string]string{"SERVER_HOST": "127.0.0.1", "SERVER_PORT": "4100"}, instance, []string{data})
	if err != nil {
		t.Fatal(err)
	}
	c := spec.Sandbox.(runner.Container)

	t.Run("runs the manifest's runtime and entry in the selected image", func(t *testing.T) {
		if spec.Runtime != "node" || spec.Entry != "index.node.js" {
			t.Fatalf("cmd = %s %s", spec.Runtime, spec.Entry)
		}
		if !strings.HasPrefix(c.Image, "node:26-slim@sha256:") || choice.Ref != c.Image {
			t.Fatalf("image = %q, choice = %+v", c.Image, choice)
		}
	})

	t.Run("mounts the resolved release read-only and writable paths at their own path", func(t *testing.T) {
		release, _ := filepath.EvalSymlinks(filepath.Join(instance, "current"))
		if len(c.Mounts) != 2 {
			t.Fatalf("mounts = %+v", c.Mounts)
		}
		if c.Mounts[0] != (runner.Mount{Source: release, Target: "/app", ReadOnly: true}) || c.WorkDir != "/app" {
			t.Fatalf("release mount = %+v, workdir = %q", c.Mounts[0], c.WorkDir)
		}
		if c.Mounts[1] != (runner.Mount{Source: data, Target: data}) {
			t.Fatalf("data mount = %+v", c.Mounts[1])
		}
	})

	t.Run("publishes on the live host port, which blue/green moves", func(t *testing.T) {
		if c.HostPort != 4100 {
			t.Fatalf("host port = %d", c.HostPort)
		}
		moved := app
		moved.HostPort = 4733
		spec, _, err := s.containerSpec(moved, m, map[string]string{}, instance, nil)
		if err != nil {
			t.Fatal(err)
		}
		if got := spec.Sandbox.(runner.Container); got.Port != 4100 || got.HostPort != 4733 {
			t.Fatalf("port = %d, host port = %d", got.Port, got.HostPort)
		}
	})

	t.Run("listens on the container's interface, published on the host's loopback port", func(t *testing.T) {
		if spec.Env["SERVER_HOST"] != "0.0.0.0" || spec.Env["SERVER_PORT"] != "4100" || c.Port != 4100 {
			t.Fatalf("env = %v, port = %d", spec.Env, c.Port)
		}
	})

	t.Run("carries the memory, task and CPU ceilings", func(t *testing.T) {
		if c.MemoryBytes != 512<<20 || c.PidsLimit != 256 || c.NanoCPUs < 1e9 || c.StopGrace != stopGrace {
			t.Fatalf("limits = %+v", c)
		}
	})

	t.Run("prepareRuntime pulls the selected image", func(t *testing.T) {
		if err := s.prepareRuntime(app); err != nil {
			t.Fatal(err)
		}
		if len(fake.pulled) != 1 || fake.pulled[0] != c.Image {
			t.Fatalf("pulled = %v", fake.pulled)
		}
	})
}

func TestNanoCPUs(t *testing.T) {
	cases := map[int]int64{1: 1e9, 2: 1e9, 4: 2e9, 8: 4e9}
	for cores, want := range cases {
		if got := nanoCPUsFor(cores); got != want {
			t.Errorf("%d cores: %d, want %d", cores, got, want)
		}
	}
}
