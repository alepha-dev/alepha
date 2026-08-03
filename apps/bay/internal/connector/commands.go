package connector

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// CommandsPath is where a sink hands out work. One definition, so a path
// disagreement cannot be silent in both directions.
const CommandsPath = "/outposts/commands"

// commandTimeout bounds one poll.
//
// Shorter than the interval between polls, like the report's. A sink that has
// become slow must not leave overlapping requests piling up on a host whose
// actual job is serving traffic — and unlike a missed report, a missed poll
// costs nothing at all: the next one is five seconds away and carries the same
// question.
const commandTimeout = 4 * time.Second

// DeployCommand is one release this machine has been given.
//
// Claimed by the sink at the moment it is handed over, so receiving one means
// this machine owns it: no other outpost will be told about it, and the status
// reports below are the only thing that moves it forward.
type DeployCommand struct {
	ReleaseID   string `json:"releaseId"`
	App         string `json:"app"`
	Environment string `json:"environment"`
	Version     string `json:"version"`
	SHA256      string `json:"sha256"`
	DownloadURL string `json:"downloadUrl"`
	SizeBytes   int64  `json:"sizeBytes,omitempty"`
}

// commandsResponse is the envelope. One command today; a named field rather
// than a bare payload so a second one is an added key instead of a wire break.
type commandsResponse struct {
	Deploy *DeployCommand `json:"deploy,omitempty"`
}

// Poll asks one sink whether there is anything to do.
//
// `nil, nil` means no. That is the overwhelmingly common answer and it is not
// an error: a machine with nothing to deploy is the normal state, and treating
// it as a failure would fill the log with the system working.
func Poll(ctx context.Context, client *http.Client, c Connector) (*DeployCommand, error) {
	ctx, cancel := context.WithTimeout(ctx, commandTimeout)
	defer cancel()

	url := strings.TrimSuffix(c.Sink, "/") + CommandsPath
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("authorization", "Bearer "+c.Token)

	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("poll %s: %w", url, err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))

	switch {
	case res.StatusCode == http.StatusNoContent:
		return nil, nil
	case res.StatusCode == http.StatusUnauthorized:
		// Named precisely, because the fix is a different command from every
		// other failure here: the token was rotated or the outpost deleted, and
		// no amount of retrying will change that.
		return nil, fmt.Errorf(
			"%s rejected token %s — it was rotated or the outpost was deleted. "+
				"Mint a new one in Lore and run `bay connector add`", url, c.Prefix())
	case res.StatusCode != http.StatusOK:
		return nil, fmt.Errorf("%s answered %d: %s", url, res.StatusCode, strings.TrimSpace(string(body)))
	}

	var parsed commandsResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("%s answered unparseable JSON: %w", url, err)
	}
	// A 200 with no command is treated as "nothing to do" rather than an error.
	// The sink is not supposed to answer that way, but guessing that an empty
	// envelope means work would send this machine into a deploy with no
	// artifact.
	return parsed.Deploy, nil
}

// StatusPathFor is where a machine says what became of a release.
func StatusPathFor(releaseID string) string {
	return "/outposts/releases/" + releaseID + "/status"
}

// ReportStatus tells the sink where a deploy has got to.
//
// Every transition, not just the outcome: something is waiting on this row, and
// a deploy that only reports its end leaves the waiter unable to tell a slow
// pull from a machine that died holding the release.
func ReportStatus(ctx context.Context, client *http.Client, c Connector, releaseID, status, failureReason string) error {
	payload, err := json.Marshal(map[string]string{
		"status":        status,
		"failureReason": failureReason,
	})
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, commandTimeout)
	defer cancel()

	url := strings.TrimSuffix(c.Sink, "/") + StatusPathFor(releaseID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("authorization", "Bearer "+c.Token)

	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("report status to %s: %w", url, err)
	}
	defer res.Body.Close()
	detail, _ := io.ReadAll(io.LimitReader(res.Body, 2048))

	if res.StatusCode == http.StatusNoContent || res.StatusCode == http.StatusOK {
		return nil
	}
	return fmt.Errorf("%s answered %d: %s", url, res.StatusCode, strings.TrimSpace(string(detail)))
}
