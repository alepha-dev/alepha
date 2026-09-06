package connector

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

/*
What a machine exchanges with the sink by command id, under the estate secret
(#1844): the two pulls a deploy makes, and the one push a `logs` answers with.

The command frame carries no bytes and no secrets: it is redelivered from
Lore's queue table on every reconnect and must not hold either. Bay pulls
both at execution time, so a secret rotated between enqueue and execute is
the one delivered, and reads only for the one command it was handed. The
vocabulary stays closed: nothing here can name an environment, a project or
a file, only `/estates/commands/<id>/...`.
*/

// MaxArtifactBytes bounds what a sink may hand this machine. Without a
// ceiling a compromised or confused sink fills the disk of a host whose job
// is serving traffic, and the first symptom would be every app failing to
// write. Half a gigabyte is far above the tens of megabytes an artifact runs
// to, and above what Lore accepts as a push.
const MaxArtifactBytes = 512 << 20

// FetchTimeout bounds one download. Generous, because it moves real bytes
// over whatever link the host has; a deploy that fails on a slow network is
// worse than one that takes a minute.
const FetchTimeout = 10 * time.Minute

// ArtifactDigestHeader is the digest the sink states beside the bytes.
const ArtifactDigestHeader = "x-artifact-sha256"

func commandURL(cfg Config, commandID, what string) string {
	return cfg.Sink + "/estates/commands/" + commandID + "/" + what
}

// ArtifactCached reports whether dest already holds the bytes the digest
// names. Re-hashed rather than trusted by name, so a torn or tampered file
// under the right name is downloaded again instead of deployed.
func ArtifactCached(dest, wantSHA256 string) bool {
	f, err := os.Open(dest)
	if err != nil {
		return false
	}
	defer f.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, f); err != nil {
		return false
	}
	return hex.EncodeToString(digest.Sum(nil)) == strings.ToLower(wantSHA256)
}

/*
PullArtifact downloads a command's artifact into dest, verified.

Three digests have to agree before a byte lands under the name the deploy
path will use: the one the command named, the one the sink states in its
header, and the one computed from the bytes as they arrive. The header is
checked before the body is read, so a sink offering a different artifact than
the command named costs no download at all. A mismatch on the bytes leaves
nothing behind: a rejected artifact on disk under a plausible name is exactly
what a later, hastier code path would pick up.

`verifying` is called once the bytes are in and before they are compared,
so the caller can report that step.
*/
func PullArtifact(ctx context.Context, client *http.Client, cfg Config, commandID, wantSHA256, dest string, verifying func()) error {
	want := strings.ToLower(strings.TrimSpace(wantSHA256))
	if len(want) != 64 {
		return fmt.Errorf("artifact digest %q is not a sha256", wantSHA256)
	}

	ctx, cancel := context.WithTimeout(ctx, FetchTimeout)
	defer cancel()
	res, err := get(ctx, client, cfg, commandURL(cfg, commandID, "artifact"))
	if err != nil {
		return err
	}
	defer res.Body.Close()

	stated := strings.ToLower(strings.TrimSpace(res.Header.Get(ArtifactDigestHeader)))
	if stated != want {
		return fmt.Errorf("the sink offers artifact %s… but the command named %s…; refusing before download",
			short(stated), short(want))
	}

	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	// Same directory as the destination so the final rename is atomic.
	tmp, err := os.CreateTemp(filepath.Dir(dest), ".artifact-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	// Removed on every path that does not rename it away.
	defer func() {
		tmp.Close()
		os.Remove(tmpName)
	}()

	digest := sha256.New()
	written, err := io.Copy(io.MultiWriter(tmp, digest), io.LimitReader(res.Body, MaxArtifactBytes+1))
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	if written > MaxArtifactBytes {
		return fmt.Errorf("artifact exceeds the %d byte ceiling", int64(MaxArtifactBytes))
	}
	if err := tmp.Sync(); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}

	if verifying != nil {
		verifying()
	}
	got := hex.EncodeToString(digest.Sum(nil))
	if got != want {
		return fmt.Errorf("artifact digest mismatch: got %s…, expected %s…", short(got), short(want))
	}
	return os.Rename(tmpName, dest)
}

// PullSecrets fetches the environment's secret set for a command. Empty until
// Lore has a secret store; a set of any size is returned as is, never logged.
func PullSecrets(ctx context.Context, client *http.Client, cfg Config, commandID string) (map[string]string, error) {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	res, err := get(ctx, client, cfg, commandURL(cfg, commandID, "secrets"))
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	var set map[string]string
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&set); err != nil {
		return nil, fmt.Errorf("the secret set is not a JSON object of strings: %w", err)
	}
	if set == nil {
		set = map[string]string{}
	}
	return set, nil
}

func get(ctx context.Context, client *http.Client, cfg Config, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Secret)
	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("pull %s: %w", url, err)
	}
	if res.StatusCode != http.StatusOK {
		detail, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		res.Body.Close()
		// The sink answers one 404 for a command it does not hold for this
		// estate, a finished one, and an unknown id, so the status alone is
		// the whole diagnosis.
		return nil, fmt.Errorf("%s answered %d: %s", url, res.StatusCode, strings.TrimSpace(string(detail)))
	}
	return res, nil
}

// short truncates a digest for a message: the first twelve characters make
// a coincidence impossible and the full pair says nothing more to a reader.
func short(digest string) string {
	if len(digest) > 12 {
		return digest[:12]
	}
	if digest == "" {
		return "(none)"
	}
	return digest
}

// ErrNoArtifact is a deploy command with nothing to fetch.
var ErrNoArtifact = errors.New("the deploy names no artifact")

/*
MaxResultBytes is what the sink accepts for a command's answer.

The caller trims to fit before it posts: a payload over this is refused whole,
and a refused upload means the row says nothing at all about what the machine
found.
*/
const MaxResultBytes = 1 << 20

/*
PushResult uploads a command's answer to the sink.

The one command whose result is a payload rather than an ack. The protocol has
no reply channel, so the answer goes back over the same machine-facing seam the
artifact and the secrets come down: addressed by command id, estate secret as
bearer, and every refusal one 404.

⚠️ Called BEFORE the terminal ack, always. The sink accepts an upload only
while the command is `sent` or `running`, so acking `done` first turns the
upload into a 404 and the owner sees a finished command with nothing to read.
*/
func PushResult(ctx context.Context, client *http.Client, cfg Config, commandID string, body []byte) error {
	if len(body) > MaxResultBytes {
		return fmt.Errorf("the result is %d bytes, over the %d the sink accepts", len(body), MaxResultBytes)
	}
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		commandURL(cfg, commandID, "result"), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Secret)
	req.Header.Set("Content-Type", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("push result: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		detail, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		// One 404 covers a command this estate does not hold, one already
		// answered and one already finished, so the status is the diagnosis.
		return fmt.Errorf("the sink answered %d: %s", res.StatusCode, strings.TrimSpace(string(detail)))
	}
	return nil
}
