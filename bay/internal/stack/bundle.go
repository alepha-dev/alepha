/*
Package stack runs groups of apps and services described by a compose file
(epic E74 in the Lore project Bay): their bundles, their compose rendering and
their environments.
*/
package stack

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"

	"github.com/alepha-dev/bay/internal/deploy"
	"github.com/alepha-dev/bay/internal/naming"
)

/*
MaxBundleBytes caps a revision bundle, unpacked: a compose file and the
configuration it mounts (`mosquitto.conf`, a realm import) are kilobytes, and a
bundle that is not belongs in an image.
*/
const MaxBundleBytes = 16 << 20

// composeNames are the file names Compose itself looks for, in its order.
var composeNames = []string{"compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"}

// Dir is a stack environment's directory: its revisions, its variables and
// its registry credentials.
func Dir(root, stack, env string) string {
	return filepath.Join(root, "stacks", naming.StackProject(stack, env))
}

// RevisionDir is where revision n of a stack environment is unpacked.
func RevisionDir(root, stack, env string, n int) string {
	return filepath.Join(Dir(root, stack, env), "revisions", strconv.Itoa(n))
}

// VarsFile holds a stack environment's variables, mode 0600.
func VarsFile(root, stack, env string) string {
	return filepath.Join(Dir(root, stack, env), ".env")
}

/*
StoreBundle unpacks a bundle archive (a compressed tar of a directory holding
the compose file and the files it references) as revision n.

Unpacked beside the final place and renamed into it, so a refused bundle leaves
no half-written revision. Refused: a link or a path escaping the bundle (the
artifact rules), a bundle over MaxBundleBytes, a bundle with no compose file.
*/
func StoreBundle(archive, root, stack, env string, n int) (string, error) {
	final := RevisionDir(root, stack, env, n)
	if err := os.MkdirAll(filepath.Dir(final), 0o700); err != nil {
		return "", err
	}
	tmp, err := os.MkdirTemp(filepath.Dir(final), ".incoming-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tmp)
	if err := deploy.Untar(archive, tmp); err != nil {
		return "", fmt.Errorf("bundle: %w", err)
	}
	var total int64
	err = filepath.WalkDir(tmp, func(_ string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		total += info.Size()
		if total > MaxBundleBytes {
			return fmt.Errorf("bundle is over %d MiB unpacked: configuration belongs in a bundle, data in a volume or an image", MaxBundleBytes>>20)
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if _, err := ComposeFile(tmp); err != nil {
		return "", err
	}
	_ = os.RemoveAll(final)
	if err := os.Rename(tmp, final); err != nil {
		return "", err
	}
	return final, nil
}

// ComposeFile finds the compose file at the root of a bundle directory.
func ComposeFile(dir string) (string, error) {
	for _, name := range composeNames {
		path := filepath.Join(dir, name)
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("the bundle has no compose file at its root (compose.yaml, compose.yml, docker-compose.yaml or docker-compose.yml)")
}
