package connector

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

/*
One-shot jobs on the wire (#Q3983, folio #F1500 decision 9).

A `job-run` command carries nothing but its id: the job's spec is pulled over
HTTPS by that id, as a stack-deploy pulls its bundle, and validated by the
executor before anything runs. A spec is structured and never an argument
list: Bay builds the command line itself from its fields, so nothing Lore
sends is executed as written.

The job's output goes back up the existing socket as batched `log` frames,
which is the first stream this connection ever carried.
*/

// MaxJobSpecBytes bounds a pulled spec. A prompt is the big field, and the
// executor bounds it again, tighter.
const MaxJobSpecBytes = 256 << 10

/*
LogFrame is a slice of a running job's output: `stream` is `stdout` or
`stderr`, `offset` is where `data` starts in that stream, counted in bytes
from the job's first byte.

The offset is what makes a replay safe. A frame written into a socket that
was already dying may never have been read, so after a reconnect the streamer
sends again from a little before where it stopped, and Lore keeps only the
bytes past what it already holds for that stream. `data` is UTF-8 text: a
chunk cut in the middle of a character is held back until the rest arrives.
*/
type LogFrame struct {
	Type   string `json:"type"`
	ID     string `json:"id"`
	Stream string `json:"stream"`
	Offset int64  `json:"offset"`
	Data   string `json:"data"`
	// Truncated is set once on the frame that reaches the per-job cap: what
	// the job printed past it was dropped on this host.
	Truncated bool `json:"truncated,omitempty"`
}

// NewLogFrame builds a log frame; the type is always "log".
func NewLogFrame(id, stream string, offset int64, data string) LogFrame {
	return LogFrame{Type: "log", ID: id, Stream: stream, Offset: offset, Data: data}
}

// PullJobSpec fetches a job-run command's spec as raw JSON: decoding and
// validating it is the executor's job, since the spec's rules are about what
// this machine will run.
func PullJobSpec(ctx context.Context, client *http.Client, cfg Config, commandID string) ([]byte, error) {
	res, err := get(ctx, client, cfg, commandURL(cfg, commandID, "job"))
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, MaxJobSpecBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read the job spec: %w", err)
	}
	if len(raw) > MaxJobSpecBytes {
		return nil, fmt.Errorf("the job spec is over the %d bytes this bay accepts", MaxJobSpecBytes)
	}
	if !json.Valid(raw) {
		return nil, fmt.Errorf("the job spec is not JSON")
	}
	return raw, nil
}

/*
RenewJobToken asks Lore for a fresh GitHub token for a running job (#Q4361):
`GET /estates/commands/<id>/github-token`, with the host's secret. Lore
answers `{token, expiresAt, botName, botEmail}` for a job of a connected
project that runs on this host, and refuses it once the job ended.
*/
func RenewJobToken(ctx context.Context, client *http.Client, cfg Config, commandID string) ([]byte, error) {
	res, err := get(ctx, client, cfg, commandURL(cfg, commandID, "github-token"))
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 4096))
	if err != nil {
		return nil, fmt.Errorf("read the renewed token: %w", err)
	}
	if !json.Valid(raw) {
		return nil, fmt.Errorf("the renewed token is not JSON")
	}
	return raw, nil
}
