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
What a machine exchanges with the sink by command id, under the host secret
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

// commandURL builds a pull URL under `/estates/commands`.
//
// Bay wire v1: it keeps the word Lore used before #E147 (estate), because
// every running Bay and every Lore speak it, and a new spelling would need a
// binary swap on every host.
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

// AppSecretAnswer is what Lore holds of a copy's APP_SECRET: the hex SHA-256
// of the key, empty when it holds none, and the key itself only when it was
// asked for. The value is never logged and never put in an error.
type AppSecretAnswer struct {
	SHA256 string `json:"sha256,omitempty"`
	Value  string `json:"value,omitempty"`
}

/*
PullAppSecret asks Lore what it holds of the APP_SECRET of the copy a deploy
command deploys: the hash always, the key only with wantValue, which Bay asks
for only when the instance has no key of its own.

Its own route, never a field of the secret set: that set is written as a
secrets file and run through refuseBayOwned, so APP_SECRET inside it would
fail the deploy of every Bay older than this route.

A 404 is an older Lore with no such route: supported is false and the deploy
goes on without a candidate, as before. Any other failure is an error, and
the caller fails the deploy rather than minting over an answer it could not
read: a minted key would then be escrowed over Lore's, the only copy of the
real one.
*/
func PullAppSecret(ctx context.Context, client *http.Client, cfg Config, commandID string, wantValue bool) (ans AppSecretAnswer, supported bool, err error) {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	url := commandURL(cfg, commandID, "app-secret")
	if wantValue {
		url += "?value=1"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return ans, false, err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Secret)
	res, err := client.Do(req)
	if err != nil {
		return ans, false, fmt.Errorf("pull the app secret: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return ans, false, nil
	}
	if res.StatusCode != http.StatusOK {
		return ans, false, fmt.Errorf("pull the app secret: the sink answered %d", res.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&ans); err != nil {
		return AppSecretAnswer{}, false, errors.New("pull the app secret: the answer is not the JSON object Bay reads")
	}
	if ans.SHA256 != "" && !isHexSHA256(ans.SHA256) {
		return AppSecretAnswer{}, false, errors.New("pull the app secret: the hash Lore answered is not a hex SHA-256")
	}
	if ans.Value != "" {
		if !wantValue {
			// Never kept when it was not asked for: an instance with a key
			// has no use for another one in memory.
			ans.Value = ""
		} else if ans.SHA256 != sha256Hex(ans.Value) {
			return AppSecretAnswer{}, false, errors.New("pull the app secret: the key Lore sent does not match the hash it sent with it")
		}
	}
	return ans, true, nil
}

// EscrowAnswer is what Lore did with an escrowed key.
type EscrowAnswer struct {
	Stored   bool `json:"stored"`
	Replaced bool `json:"replaced"`
}

/*
PushAppSecret sends the key the instance runs on to Lore, which stores it
sealed as the copy's APP_SECRET row, so a rebuilt host gets it back. Its own
route, inside the deploy command, never the command's result or ack: a
result is stored as a file the owner reads.

supported is false on a 404 (an older Lore, or a command Lore knows no copy
for). The key is never put in an error.
*/
func PushAppSecret(ctx context.Context, client *http.Client, cfg Config, commandID, key string) (ans EscrowAnswer, supported bool, err error) {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	body, err := json.Marshal(map[string]string{"value": key})
	if err != nil {
		return ans, false, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, commandURL(cfg, commandID, "app-secret"), bytes.NewReader(body))
	if err != nil {
		return ans, false, err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Secret)
	req.Header.Set("Content-Type", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return ans, false, fmt.Errorf("escrow the app secret: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return ans, false, nil
	}
	if res.StatusCode != http.StatusOK {
		return ans, false, fmt.Errorf("escrow the app secret: the sink answered %d", res.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<10)).Decode(&ans); err != nil {
		return EscrowAnswer{}, false, errors.New("escrow the app secret: the answer is not the JSON object Bay reads")
	}
	return ans, true, nil
}

// SHA256Hex is the hex SHA-256 Lore answers for a key, for the comparison
// that decides whether to escrow.
func SHA256Hex(s string) string { return sha256Hex(s) }

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func isHexSHA256(s string) bool {
	if len(s) != 64 {
		return false
	}
	_, err := hex.DecodeString(s)
	return err == nil && strings.ToLower(s) == s
}

// RegistryCredential is one registry login a stack-deploy pulls, for the
// stack's images.
type RegistryCredential struct {
	Host     string `json:"host"`
	Username string `json:"username"`
	Password string `json:"password"`
}

/*
PullRegistries fetches the registry credentials of a stack-deploy's project,
by command id, the way the secret set comes down: never in the command frame,
which Lore stores.

A 404 is an older Lore with no such route, and answers no credential rather
than failing the deploy; the stack then pulls with whatever credentials the
environment already holds.
*/
func PullRegistries(ctx context.Context, client *http.Client, cfg Config, commandID string) ([]RegistryCredential, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, commandURL(cfg, commandID, "registries"), nil)
	if err != nil {
		return nil, false, err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Secret)
	res, err := client.Do(req)
	if err != nil {
		return nil, false, fmt.Errorf("pull registries: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return nil, false, nil
	}
	if res.StatusCode != http.StatusOK {
		return nil, false, fmt.Errorf("pull registries: the sink answered %d", res.StatusCode)
	}
	var out []RegistryCredential
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&out); err != nil {
		return nil, false, fmt.Errorf("the registry credentials are not a JSON list: %w", err)
	}
	return out, true, nil
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
		// host, a finished one, and an unknown id, so the status alone is
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
artifact and the secrets come down: addressed by command id, host secret as
bearer, and every refusal one 404.

⚠️ Called BEFORE the terminal ack, always. The sink accepts an upload only
while the command is `sent` or `running`, so acking `done` first turns the
upload into a 404 and the owner sees a finished command with nothing to read.
*/
func PushResult(ctx context.Context, client *http.Client, cfg Config, commandID string, body []byte) error {
	return push(ctx, client, cfg, commandID, "result", body)
}

/*
PushOutcome uploads what a stack-deploy did (its revision, plan, digests and
members) so Lore's deployment row says it. Same seam and the same rule as
PushResult: before the terminal ack, and a refusal is logged, never a failed
deploy.
*/
func PushOutcome(ctx context.Context, client *http.Client, cfg Config, commandID string, body []byte) error {
	return push(ctx, client, cfg, commandID, "outcome", body)
}

func push(ctx context.Context, client *http.Client, cfg Config, commandID, path string, body []byte) error {
	if len(body) > MaxResultBytes {
		return fmt.Errorf("the result is %d bytes, over the %d the sink accepts", len(body), MaxResultBytes)
	}
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		commandURL(cfg, commandID, path), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Secret)
	req.Header.Set("Content-Type", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("push %s: %w", path, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		detail, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		// One 404 covers a command this host does not hold, one already
		// answered and one already finished, so the status is the diagnosis.
		return fmt.Errorf("the sink answered %d: %s", res.StatusCode, strings.TrimSpace(string(detail)))
	}
	return nil
}
