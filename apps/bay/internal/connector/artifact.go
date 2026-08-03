package connector

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// maxArtifact bounds what a sink may hand this machine.
//
// Without a ceiling, a compromised or confused sink fills the disk of a host
// whose actual job is serving traffic — and the first symptom would be every
// hosted app failing to write, not a failed download. Half a gigabyte is far
// above the ~10 MB an artifact runs to, and above the 100 MB a Worker can even
// accept as a body.
const maxArtifact = 512 << 20

// fetchTimeout bounds one download.
//
// Generous compared to the report and command timeouts because this one moves
// real bytes over whatever link the host has, and a deploy that fails on a slow
// network is worse than a deploy that takes a minute.
const fetchTimeout = 10 * time.Minute

// Fetch downloads an artifact and refuses anything that is not what was
// promised.
//
// The digest is verified as the bytes arrive rather than by re-reading the file
// afterwards: the point is to never let unverified bytes reach the name the
// deploy path will use. A mismatch leaves nothing behind — a rejected artifact
// on disk under a plausible name is exactly the thing a later, hastier code
// path would pick up.
func Fetch(ctx context.Context, client *http.Client, url, token, wantSHA256, dest string) error {
	want := strings.ToLower(strings.TrimSpace(wantSHA256))
	if len(want) != 64 {
		return fmt.Errorf("artifact digest %q is not a sha256", wantSHA256)
	}

	ctx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("authorization", "Bearer "+token)

	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("fetch %s: %w", url, err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		detail, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		return fmt.Errorf("%s answered %d: %s", url, res.StatusCode, strings.TrimSpace(string(detail)))
	}

	// Same directory as the destination so the final rename is atomic: across
	// filesystems it would degrade to a copy, and a torn artifact could then
	// carry the name of a whole one.
	tmp, err := os.CreateTemp(filepath.Dir(dest), ".artifact-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	// Removed on every path that does not rename it away. A deploy that fails
	// mid-download must not leave the disk fuller than it found it.
	defer func() {
		tmp.Close()
		os.Remove(tmpName)
	}()

	digest := sha256.New()
	written, err := io.Copy(io.MultiWriter(tmp, digest), io.LimitReader(res.Body, maxArtifact+1))
	if err != nil {
		return fmt.Errorf("download %s: %w", url, err)
	}
	if written > maxArtifact {
		return fmt.Errorf("artifact from %s exceeds the %d byte ceiling", url, int64(maxArtifact))
	}
	if err := tmp.Sync(); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}

	got := hex.EncodeToString(digest.Sum(nil))
	if got != want {
		// Truncated on both sides: the full pair says nothing more to a human
		// reading a log, and the first twelve characters already make a
		// coincidence impossible.
		return fmt.Errorf("artifact digest mismatch: got %s…, expected %s…", got[:12], want[:12])
	}

	if err := os.Rename(tmpName, dest); err != nil {
		return err
	}
	return nil
}
