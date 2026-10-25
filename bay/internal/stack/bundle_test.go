package stack

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func bundleArchive(t *testing.T, files map[string]string) string {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, body := range files {
		if err := tw.WriteHeader(&tar.Header{Name: name, Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len(body))}); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	tw.Close()
	gz.Close()
	path := filepath.Join(t.TempDir(), "bundle.tar.gz")
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestStoreBundle(t *testing.T) {
	t.Run("unpacks the compose file and its referenced files as a revision", func(t *testing.T) {
		root := t.TempDir()
		archive := bundleArchive(t, map[string]string{
			"compose.yml":           "services: {}\n",
			"config/mosquitto.conf": "listener 1883\n",
		})
		dir, err := StoreBundle(archive, root, "broker", "production", 1)
		if err != nil {
			t.Fatal(err)
		}
		if dir != filepath.Join(root, "stacks", "broker-production", "revisions", "1") {
			t.Fatalf("dir = %s", dir)
		}
		if raw, _ := os.ReadFile(filepath.Join(dir, "config", "mosquitto.conf")); string(raw) != "listener 1883\n" {
			t.Fatalf("config = %q", raw)
		}
	})

	t.Run("a bundle without a compose file is refused and leaves nothing", func(t *testing.T) {
		root := t.TempDir()
		_, err := StoreBundle(bundleArchive(t, map[string]string{"README.md": "x"}), root, "a", "production", 1)
		if err == nil || !strings.Contains(err.Error(), "compose file") {
			t.Fatalf("err = %v", err)
		}
		if _, err := os.Stat(RevisionDir(root, "a", "production", 1)); !os.IsNotExist(err) {
			t.Fatal("a refused bundle left a revision behind")
		}
	})

	t.Run("an oversized bundle is refused", func(t *testing.T) {
		root := t.TempDir()
		_, err := StoreBundle(bundleArchive(t, map[string]string{
			"compose.yml": "services: {}\n",
			"big.bin":     strings.Repeat("x", MaxBundleBytes+1),
		}), root, "a", "production", 1)
		if err == nil || !strings.Contains(err.Error(), "MiB") {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("every compose file name compose accepts is found", func(t *testing.T) {
		for _, name := range []string{"compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"} {
			dir := t.TempDir()
			_ = os.WriteFile(filepath.Join(dir, name), []byte("services: {}\n"), 0o644)
			if got, err := ComposeFile(dir); err != nil || filepath.Base(got) != name {
				t.Errorf("%s: %s, %v", name, got, err)
			}
		}
	})
}
