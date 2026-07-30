package deploy

import (
	"archive/tar"
	"compress/gzip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// entry is one archive member, described the way a hostile archive would.
type entry struct {
	name     string
	typeflag byte
	body     string
	linkname string
	mode     int64
}

// buildArchive writes a tar.gz containing exactly the given entries — including
// ones the tar writer would never produce from a real filesystem walk.
func buildArchive(t *testing.T, entries ...entry) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "artifact.tar.gz")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	gz := gzip.NewWriter(f)
	tw := tar.NewWriter(gz)
	for _, e := range entries {
		flag := e.typeflag
		if flag == 0 {
			flag = tar.TypeReg
		}
		mode := e.mode
		if mode == 0 {
			mode = 0o644
		}
		hdr := &tar.Header{
			Name:     e.name,
			Typeflag: flag,
			Size:     int64(len(e.body)),
			Mode:     mode,
			Linkname: e.linkname,
		}
		if flag == tar.TypeDir {
			hdr.Size = 0
		}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatal(err)
		}
		if hdr.Size > 0 {
			if _, err := tw.Write([]byte(e.body)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestUntarExtractsTheArtifactLayout(t *testing.T) {
	src := buildArchive(t,
		entry{name: "dist/", typeflag: tar.TypeDir},
		entry{name: "dist/index.js", body: "console.log(1)"},
		entry{name: "dist/manifest.json", body: `{"project":"lore"}`},
		entry{name: "migrations/sqlite/0001.sql", body: "select 1;"},
	)
	dest := filepath.Join(t.TempDir(), "release")

	if err := untar(src, dest); err != nil {
		t.Fatal(err)
	}

	for _, want := range []string{"dist/index.js", "dist/manifest.json", "migrations/sqlite/0001.sql"} {
		if _, err := os.Stat(filepath.Join(dest, filepath.FromSlash(want))); err != nil {
			t.Fatalf("%s should have been extracted: %v", want, err)
		}
	}
	body, err := os.ReadFile(filepath.Join(dest, "dist", "index.js"))
	if err != nil || string(body) != "console.log(1)" {
		t.Fatalf("content not preserved: %q %v", body, err)
	}
}

func TestUntarRefusesTraversal(t *testing.T) {
	// Bay unpacks as root, before any sandbox applies: a `..` entry would write
	// anywhere on the host.
	for _, name := range []string{
		"../escaped.js",
		"dist/../../escaped.js",
		"/etc/cron.d/escaped",
	} {
		t.Run(name, func(t *testing.T) {
			src := buildArchive(t, entry{name: name, body: "pwned"})
			dest := filepath.Join(t.TempDir(), "release")

			err := untar(src, dest)
			if err == nil {
				t.Fatal("expected the entry to be refused")
			}
			if !strings.Contains(err.Error(), "escapes destination") {
				t.Fatalf("error should say what happened, got: %v", err)
			}
		})
	}
}

func TestUntarRefusesLinks(t *testing.T) {
	// The standard tar escape: land a symlink pointing outside the destination,
	// then have a later entry write "through" it. Refusing links outright is
	// both safer and simpler than deciding which ones are benign — an app
	// bundle has no legitimate use for them.
	cases := []struct {
		label string
		e     entry
	}{
		{"symlink", entry{name: "dist/evil", typeflag: tar.TypeSymlink, linkname: "/etc"}},
		{"hardlink", entry{name: "dist/evil", typeflag: tar.TypeLink, linkname: "/etc/passwd"}},
		{"fifo", entry{name: "dist/evil", typeflag: tar.TypeFifo}},
		{"char device", entry{name: "dist/evil", typeflag: tar.TypeChar}},
	}
	for _, c := range cases {
		t.Run(c.label, func(t *testing.T) {
			src := buildArchive(t, c.e)
			dest := filepath.Join(t.TempDir(), "release")

			err := untar(src, dest)
			if err == nil {
				t.Fatalf("expected a %s entry to be refused", c.label)
			}
			if !strings.Contains(err.Error(), "unsupported type") {
				t.Fatalf("error should name the problem, got: %v", err)
			}
		})
	}
}

func TestUntarDoesNotHonourArchiveMode(t *testing.T) {
	// Honouring a setuid bit out of an uploaded tarball, unpacked as root,
	// would be a privilege-escalation primitive.
	src := buildArchive(t, entry{name: "dist/index.js", body: "x", mode: 0o4777})
	dest := filepath.Join(t.TempDir(), "release")

	if err := untar(src, dest); err != nil {
		t.Fatal(err)
	}

	info, err := os.Stat(filepath.Join(dest, "dist", "index.js"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o644 {
		t.Fatalf("mode should be forced to 0644, got %v", info.Mode())
	}
	if info.Mode()&os.ModeSetuid != 0 {
		t.Fatal("setuid must never survive extraction")
	}
}

func TestUntarRejectsNonGzip(t *testing.T) {
	// A plain tar, or anything else, must fail with a message that says so
	// rather than producing an empty release that then "never becomes ready".
	path := filepath.Join(t.TempDir(), "not.tar.gz")
	if err := os.WriteFile(path, []byte("this is not gzip"), 0o600); err != nil {
		t.Fatal(err)
	}

	err := untar(path, filepath.Join(t.TempDir(), "release"))
	if err == nil {
		t.Fatal("expected a non-gzip artifact to be refused")
	}
	if !strings.Contains(err.Error(), "gzip") {
		t.Fatalf("error should name the format, got: %v", err)
	}
}

func TestUntarRefusesOversizedEntry(t *testing.T) {
	// A decompression bomb filling the disk takes down every app on the
	// machine, not just the one being deployed.
	path := filepath.Join(t.TempDir(), "big.tar.gz")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	gz := gzip.NewWriter(f)
	tw := tar.NewWriter(gz)
	// Declare a size past the ceiling without writing the bytes: the header is
	// what the guard has to reject, since trusting it and copying is the bug.
	if err := tw.WriteHeader(&tar.Header{
		Name:     "dist/huge.bin",
		Typeflag: tar.TypeReg,
		Size:     maxEntrySize + 1,
		Mode:     0o644,
	}); err != nil {
		t.Fatal(err)
	}
	_ = tw.Close()
	_ = gz.Close()
	_ = f.Close()

	err = untar(path, filepath.Join(t.TempDir(), "release"))
	if err == nil {
		t.Fatal("expected an oversized entry to be refused")
	}
	if !strings.Contains(err.Error(), "limit") {
		t.Fatalf("error should name the limit, got: %v", err)
	}
}
