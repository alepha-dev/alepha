package stack

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

/*
DockerConfigDir holds a stack environment's registry credentials, in Docker's
own config.json format, read by Bay to pull its images.

One per stack environment, never a global `docker login`: a credential of one
project must not be usable by another project's stack on the same host, and a
global login is exactly that.
*/
func DockerConfigDir(root, stack, env string) string {
	return filepath.Join(Dir(root, stack, env), ".docker")
}

type dockerConfig struct {
	Auths map[string]dockerAuth `json:"auths"`
}

type dockerAuth struct {
	Auth string `json:"auth"`
}

func readDockerConfig(root, stack, env string) (dockerConfig, error) {
	cfg := dockerConfig{Auths: map[string]dockerAuth{}}
	raw, err := os.ReadFile(filepath.Join(DockerConfigDir(root, stack, env), "config.json"))
	if os.IsNotExist(err) {
		return cfg, nil
	}
	if err != nil {
		return cfg, err
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return cfg, fmt.Errorf("stack registry config: %w", err)
	}
	if cfg.Auths == nil {
		cfg.Auths = map[string]dockerAuth{}
	}
	return cfg, nil
}

func writeDockerConfig(root, stack, env string, cfg dockerConfig) error {
	dir := DockerConfigDir(root, stack, env)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".config-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(raw); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), filepath.Join(dir, "config.json"))
}

// SetCredential stores a registry credential for a stack environment.
func SetCredential(root, stack, env, host, username, password string) error {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "" || strings.ContainsAny(host, "/ ") || username == "" || password == "" {
		return fmt.Errorf("a registry credential needs a host (registry.example.com), a username and a password")
	}
	cfg, err := readDockerConfig(root, stack, env)
	if err != nil {
		return err
	}
	cfg.Auths[host] = dockerAuth{Auth: base64.StdEncoding.EncodeToString([]byte(username + ":" + password))}
	return writeDockerConfig(root, stack, env, cfg)
}

// RemoveCredential forgets a registry; false when there was none.
func RemoveCredential(root, stack, env, host string) (bool, error) {
	cfg, err := readDockerConfig(root, stack, env)
	if err != nil {
		return false, err
	}
	host = strings.ToLower(host)
	if _, ok := cfg.Auths[host]; !ok {
		return false, nil
	}
	delete(cfg.Auths, host)
	return true, writeDockerConfig(root, stack, env, cfg)
}

// RegistryHosts lists the registries a stack environment has credentials
// for, never the credentials.
func RegistryHosts(root, stack, env string) ([]string, error) {
	cfg, err := readDockerConfig(root, stack, env)
	if err != nil {
		return nil, err
	}
	hosts := make([]string, 0, len(cfg.Auths))
	for h := range cfg.Auths {
		hosts = append(hosts, h)
	}
	sort.Strings(hosts)
	return hosts, nil
}

/*
RegistryAuthFor answers the Engine API's X-Registry-Auth value for an image,
from the stack environment's credentials, or "" for an image whose registry
has none (a public image).
*/
func RegistryAuthFor(root, stack, env, image string) (string, error) {
	cfg, err := readDockerConfig(root, stack, env)
	if err != nil {
		return "", err
	}
	host := RegistryHost(image)
	entry, ok := cfg.Auths[host]
	if !ok {
		return "", nil
	}
	raw, err := base64.StdEncoding.DecodeString(entry.Auth)
	if err != nil {
		return "", fmt.Errorf("stack registry config for %s is corrupt", host)
	}
	user, pass, _ := strings.Cut(string(raw), ":")
	header, _ := json.Marshal(map[string]string{"username": user, "password": pass, "serveraddress": host})
	return base64.URLEncoding.EncodeToString(header), nil
}

/*
RegistryHost is the registry an image reference names: its first path segment
when that looks like a host (a dot, a port, or localhost), Docker Hub
otherwise.
*/
func RegistryHost(image string) string {
	first, _, found := strings.Cut(image, "/")
	if found && (strings.ContainsAny(first, ".:") || first == "localhost") {
		return strings.ToLower(first)
	}
	return "docker.io"
}

/*
Mirrored rewrites a Docker Hub reference to a pull-through mirror:
`postgres:15` is `<mirror>/library/postgres:15`, `oven/bun:1` is
`<mirror>/oven/bun:1`. Any other registry is left alone, and so is everything
when no mirror is set.
*/
func Mirrored(image, mirror string) string {
	if mirror == "" || RegistryHost(image) != "docker.io" {
		return image
	}
	path := strings.TrimPrefix(image, "docker.io/")
	if !strings.Contains(strings.SplitN(path, "@", 2)[0], "/") {
		path = "library/" + path
	}
	return strings.TrimSuffix(mirror, "/") + "/" + path
}
