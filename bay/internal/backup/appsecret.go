package backup

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"

	"github.com/alepha-dev/bay/internal/s3"
)

/*
A bundle carries the instance's APP_SECRET as an object of its own:

	apps/<instance>/db/<stamp>/app-secret

uploaded with the databases, before the manifest. The manifest records only the
key's SHA-256 (`appSecretSha256`), never the key: a manifest is parsed and
handed around (into `state.json`, into the restore answer Lore stores as a
file, into `bay backups`), so a secret in it would be one serialisation away
from a file or a log.

The key is what the MFA rows and the signed links of that data were sealed
with, which is why it travels with the databases and is put back only with
them, and only into the instance the bundle was taken from.

Retention needs nothing more: listing groups a bundle by its stamp directory,
so the object is deleted with its bundle.
*/
const appSecretName = "app-secret"

// maxAppSecretBytes bounds a key read back from a bucket. Bay mints 64 hex
// characters; anything near this size is not a key Bay wrote.
const maxAppSecretBytes = 4096

// AppSecretSHA256 is the hex SHA-256 a manifest records for a key, and what
// `bay doctor` compares an instance's key against.
func AppSecretSHA256(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

// The states of a fetched bundle's key, as answers and records say them.
const (
	// SecretCarried: the bundle holds a key and it was read back intact.
	SecretCarried = "carried"
	// SecretAbsent: the bundle predates keys, or is not a bundle at all.
	SecretAbsent = "absent"
	// SecretMissing: the manifest says the bundle carries a key, and the
	// object is not in the bucket (removed by hand, or a lifecycle rule).
	SecretMissing = "missing"
)

// validAppSecret refuses a value that cannot be a key: a bucket is data, and
// what is read from it is written into a `.env`.
func validAppSecret(key string) error {
	if key == "" {
		return errors.New("the key is empty")
	}
	if len(key) > maxAppSecretBytes {
		return fmt.Errorf("the key is %d bytes, more than %d", len(key), maxAppSecretBytes)
	}
	for _, r := range key {
		if r < 0x21 || r == 0x7f {
			return errors.New("the key holds a space or a control character")
		}
	}
	return nil
}

// fetchAppSecret reads a bundle's key object and checks it against the
// manifest. A missing object is SecretMissing, not a failure: the data is
// still worth restoring, and the caller says the key did not come back.
func (m *Manager) fetchAppSecret(ctx context.Context, prefix string, man *Manifest) (key, status string, err error) {
	if man.AppSecretSHA256 == "" {
		return "", SecretAbsent, nil
	}
	body, err := m.store.Get(ctx, prefix+appSecretName)
	if err != nil {
		var se *s3.StatusError
		if errors.As(err, &se) && se.Code == http.StatusNotFound {
			return "", SecretMissing, nil
		}
		return "", "", fmt.Errorf("download %s: %w", prefix+appSecretName, err)
	}
	key = string(body)
	if err := validAppSecret(key); err != nil {
		return "", "", fmt.Errorf("%s: %w", prefix+appSecretName, err)
	}
	if AppSecretSHA256(key) != man.AppSecretSHA256 {
		// Never the hashes in the message: the manifest's is in the bucket for
		// anyone to read, but the other is of whatever the object holds.
		return "", "", fmt.Errorf("%s does not match the checksum its manifest records", prefix+appSecretName)
	}
	return key, SecretCarried, nil
}
