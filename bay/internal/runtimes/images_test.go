package runtimes

import (
	"strings"
	"testing"
)

func TestSelect(t *testing.T) {
	t.Run("picks the pinned image for the manifest's runtime and major", func(t *testing.T) {
		sel, err := Select("node", "26", "", nil)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(sel.Ref, "node:26-slim@sha256:") || sel.Warning != "" || sel.Override {
			t.Fatalf("selection = %+v", sel)
		}
		sel, err = Select("bun", "1", "", nil)
		if err != nil || !strings.HasPrefix(sel.Ref, "oven/bun:1-slim@sha256:") {
			t.Fatalf("selection = %+v, err = %v", sel, err)
		}
	})

	t.Run("a refreshed digest beats the table's", func(t *testing.T) {
		locks := map[string]string{"node:26-slim": "node:26-slim@sha256:newer"}
		sel, err := Select("node", "26", "", locks)
		if err != nil || sel.Ref != "node:26-slim@sha256:newer" {
			t.Fatalf("selection = %+v, err = %v", sel, err)
		}
	})

	t.Run("an override wins outright", func(t *testing.T) {
		sel, err := Select("node", "26", "node:26-alpine", nil)
		if err != nil || sel.Ref != "node:26-alpine" || !sel.Override {
			t.Fatalf("selection = %+v, err = %v", sel, err)
		}
	})

	t.Run("no major runs on the default, with a warning", func(t *testing.T) {
		sel, err := Select("node", "", "", nil)
		if err != nil || sel.Image.Major != DefaultMajor["node"] || sel.Warning == "" {
			t.Fatalf("selection = %+v, err = %v", sel, err)
		}
	})

	t.Run("an unsupported major is refused with the supported list", func(t *testing.T) {
		_, err := Select("node", "18", "", nil)
		if err == nil || !strings.Contains(err.Error(), "22, 24, 26") {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("an unknown runtime is refused", func(t *testing.T) {
		if _, err := Select("deno", "2", "", nil); err == nil {
			t.Fatal("deno accepted")
		}
		if _, err := Select("deno", "", "", nil); err == nil {
			t.Fatal("deno accepted without a major")
		}
	})

	t.Run("every pinned image carries a digest and a default exists for each runtime", func(t *testing.T) {
		for _, img := range Images {
			if !strings.HasPrefix(img.Digest, "sha256:") || len(img.Digest) != 71 {
				t.Errorf("%s: digest %q", img.Tag, img.Digest)
			}
			if strings.Contains(img.Tag, "alpine") {
				t.Errorf("%s: Alpine is never a default image", img.Tag)
			}
		}
		for runtime, major := range DefaultMajor {
			if _, err := Select(runtime, major, "", nil); err != nil {
				t.Errorf("default %s %s is not in the table: %v", runtime, major, err)
			}
		}
	})
}
