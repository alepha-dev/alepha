package stack

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRegistries(t *testing.T) {
	t.Run("a credential is stored 0600 in the stack's own Docker config, hosts listed, secret not", func(t *testing.T) {
		root := t.TempDir()
		if err := SetCredential(root, "mcs", "staging", "Registry.Acme.io", "ci", "s3cret"); err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(DockerConfigDir(root, "mcs", "staging"), "config.json")
		info, err := os.Stat(path)
		if err != nil || info.Mode().Perm() != 0o600 {
			t.Fatalf("config: %v %v", info, err)
		}
		hosts, _ := RegistryHosts(root, "mcs", "staging")
		if strings.Join(hosts, ",") != "registry.acme.io" {
			t.Fatalf("hosts = %v", hosts)
		}
		if other, _ := RegistryHosts(root, "mcs", "production"); len(other) != 0 {
			t.Fatal("a credential leaked to another environment")
		}
	})

	t.Run("the Engine API header carries the credential for that registry only", func(t *testing.T) {
		root := t.TempDir()
		_ = SetCredential(root, "mcs", "staging", "registry.acme.io", "ci", "s3cret")
		header, err := RegistryAuthFor(root, "mcs", "staging", "registry.acme.io/team/api:1@sha256:x")
		if err != nil || header == "" {
			t.Fatalf("header = %q, err = %v", header, err)
		}
		raw, _ := base64.URLEncoding.DecodeString(header)
		var auth map[string]string
		_ = json.Unmarshal(raw, &auth)
		if auth["username"] != "ci" || auth["password"] != "s3cret" || auth["serveraddress"] != "registry.acme.io" {
			t.Fatalf("auth = %v", auth)
		}
		if public, _ := RegistryAuthFor(root, "mcs", "staging", "postgres:17"); public != "" {
			t.Fatal("a public image got a credential")
		}
	})

	t.Run("a credential is removed", func(t *testing.T) {
		root := t.TempDir()
		_ = SetCredential(root, "a", "production", "ghcr.io", "u", "p")
		if ok, _ := RemoveCredential(root, "a", "production", "ghcr.io"); !ok {
			t.Fatal("not removed")
		}
		if ok, _ := RemoveCredential(root, "a", "production", "ghcr.io"); ok {
			t.Fatal("removed twice")
		}
	})

	t.Run("registry hosts and mirroring", func(t *testing.T) {
		cases := map[string]string{
			"postgres:17": "docker.io", "oven/bun:1": "docker.io", "ghcr.io/x/y:1": "ghcr.io",
			"localhost:5000/a": "localhost:5000", "localhost/a": "localhost", "docker.io/library/redis": "docker.io",
		}
		for image, want := range cases {
			if got := RegistryHost(image); got != want {
				t.Errorf("%s: %s", image, got)
			}
		}
		mirror := "mirror.acme.io"
		mirrored := map[string]string{
			"postgres:17":                    "mirror.acme.io/library/postgres:17",
			"oven/bun:1-slim@sha256:a":       "mirror.acme.io/oven/bun:1-slim@sha256:a",
			"docker.io/library/redis:7":      "mirror.acme.io/library/redis:7",
			"ghcr.io/umami-software/umami:1": "ghcr.io/umami-software/umami:1",
		}
		for image, want := range mirrored {
			if got := Mirrored(image, mirror); got != want {
				t.Errorf("%s: %s", image, got)
			}
		}
		if Mirrored("postgres:17", "") != "postgres:17" {
			t.Error("no mirror changed a reference")
		}
	})
}
