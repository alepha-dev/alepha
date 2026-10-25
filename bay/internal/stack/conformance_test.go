package stack

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

/*
The compose conformance set: files Bay accepts and files it refuses, with the
words it refuses them in. Lore copies testdata/conformance into
packages/@lore/deploy/test/fixtures/bay/compose and runs the same cases
through its own parser, so a file fails at upload exactly where and how it
would fail here. Bay's copy is the authority.
*/
func TestConformance(t *testing.T) {
	requireCompose(t)
	root := filepath.Join("testdata", "conformance")
	vars := map[string]string{"DB_PASSWORD": "conformance"}

	accepted, _ := os.ReadDir(filepath.Join(root, "accepted"))
	for _, entry := range accepted {
		t.Run("accepts "+entry.Name(), func(t *testing.T) {
			dir := t.TempDir()
			src := filepath.Join(root, "accepted", entry.Name())
			files, _ := os.ReadDir(src)
			for _, f := range files {
				body, _ := os.ReadFile(filepath.Join(src, f.Name()))
				_ = os.WriteFile(filepath.Join(dir, f.Name()), body, 0o644)
			}
			if err := checkCompose(dir, vars); err != nil {
				t.Fatal(err)
			}
		})
	}

	raw, err := os.ReadFile(filepath.Join(root, "refused", "cases.yml"))
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name    string `yaml:"name"`
		Expect  string `yaml:"expect"`
		Compose string `yaml:"compose"`
	}
	if err := yaml.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		t.Run("refuses "+c.Name, func(t *testing.T) {
			dir := t.TempDir()
			_ = os.WriteFile(filepath.Join(dir, "compose.yml"), []byte(c.Compose), 0o644)
			err := checkCompose(dir, vars)
			if err == nil || !strings.Contains(err.Error(), c.Expect) {
				t.Fatalf("err = %v, want %q", err, c.Expect)
			}
		})
	}
}

// checkCompose runs what a deploy runs before applying: load, validate, x-lore.
func checkCompose(dir string, vars map[string]string) error {
	l, err := Load(dir, "conformance-test", vars)
	if err != nil {
		return err
	}
	if err := l.Validate(); err != nil {
		return err
	}
	_, err = l.Lore()
	return err
}
