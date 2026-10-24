package deploy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alepha-dev/bay/internal/state"
)

const testImage = "registry.example/api:1.4.2@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func imageStore(t *testing.T) (string, *state.Store) {
	t.Helper()
	root := t.TempDir()
	store, err := state.Open(filepath.Join(root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	return root, store
}

func TestRunImage(t *testing.T) {
	t.Run("registers the app by digest on a composed domain, with a host port", func(t *testing.T) {
		root, store := imageStore(t)
		res, err := RunImage(ImageOptions{Root: root, Name: "api", Env: "staging", BaseDomain: "bay.test",
			Image: testImage, ContainerPort: 3000, HealthPath: "/healthz"}, store)
		if err != nil {
			t.Fatal(err)
		}
		app := res.App
		if app.Domain() != "api-staging.bay.test" || app.Image != testImage || app.ContainerPort != 3000 ||
			app.HealthPath != "/healthz" || app.Port == 0 || app.Release != "sha256:0123456789ab" {
			t.Fatalf("app = %+v", app)
		}
		if _, err := os.Stat(filepath.Join(root, "apps", "api-staging", ".env")); err != nil {
			t.Fatalf(".env not created: %v", err)
		}
	})

	t.Run("a tag without a digest is refused", func(t *testing.T) {
		root, store := imageStore(t)
		_, err := RunImage(ImageOptions{Root: root, Name: "api", Env: "production", BaseDomain: "bay.test",
			Image: "registry.example/api:latest", ContainerPort: 3000}, store)
		if err == nil || !strings.Contains(err.Error(), "digest") {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("a missing port or a relative health path is refused", func(t *testing.T) {
		root, store := imageStore(t)
		if _, err := RunImage(ImageOptions{Root: root, Name: "api", Env: "production", BaseDomain: "bay.test", Image: testImage}, store); err == nil {
			t.Fatal("no port accepted")
		}
		if _, err := RunImage(ImageOptions{Root: root, Name: "api", Env: "production", BaseDomain: "bay.test",
			Image: testImage, ContainerPort: 3000, HealthPath: "healthz"}, store); err == nil {
			t.Fatal("relative health path accepted")
		}
	})

	t.Run("a redeploy keeps the domain and the port, and reports what it replaced", func(t *testing.T) {
		root, store := imageStore(t)
		first, err := RunImage(ImageOptions{Root: root, Name: "api", Env: "production", BaseDomain: "bay.test",
			Image: testImage, ContainerPort: 3000}, store)
		if err != nil {
			t.Fatal(err)
		}
		next := strings.Replace(testImage, "0123456789ab", "ba9876543210", 1)
		second, err := RunImage(ImageOptions{Root: root, Name: "api", Env: "production", Image: next, ContainerPort: 3000}, store)
		if err != nil {
			t.Fatal(err)
		}
		if !second.Redeploy || second.Previous.Image != testImage || second.App.Port != first.App.Port ||
			second.App.Domain() != first.App.Domain() || second.App.Image != next {
			t.Fatalf("second = %+v", second)
		}
	})

	t.Run("an archive app's name is not taken over by an image", func(t *testing.T) {
		root, store := imageStore(t)
		_ = store.Upsert(state.App{Name: "api", Env: "production", Port: 4100, Release: "r1"})
		_, err := RunImage(ImageOptions{Root: root, Name: "api", Env: "production", BaseDomain: "bay.test",
			Image: testImage, ContainerPort: 3000}, store)
		if err == nil || !strings.Contains(err.Error(), "archive") {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("secrets are merged and Bay's keys refused", func(t *testing.T) {
		root, store := imageStore(t)
		if _, err := RunImage(ImageOptions{Root: root, Name: "api", Env: "production", BaseDomain: "bay.test",
			Image: testImage, ContainerPort: 3000, Secrets: map[string]string{"APP_SECRET": "x"}}, store); err == nil {
			t.Fatal("a Bay-owned key was accepted")
		}
		if _, err := RunImage(ImageOptions{Root: root, Name: "api", Env: "production", BaseDomain: "bay.test",
			Image: testImage, ContainerPort: 3000, Secrets: map[string]string{"STRIPE_KEY": "sk_test"}}, store); err != nil {
			t.Fatal(err)
		}
		raw, _ := os.ReadFile(filepath.Join(root, "apps", "api-production", ".env"))
		if !strings.Contains(string(raw), "STRIPE_KEY") {
			t.Fatalf(".env = %s", raw)
		}
	})
}
