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

// ReportPath is where a sink accepts a report. One definition, so a path
// disagreement cannot be silent in both directions.
const ReportPath = "/outposts/report"

// pushTimeout bounds one report.
//
// Short, and deliberately shorter than the interval between reports: a sink
// that has become slow must not leave overlapping requests piling up on a host
// whose actual job is serving traffic. A missed report costs a gap in a
// dashboard; a pile of stuck ones costs the machine.
const pushTimeout = 15 * time.Second

// Push sends one report to one connector.
//
// Errors are returned rather than retried. The next report is a minute away and
// carries the same information plus whatever happened since — a retry would
// only send an older copy of a payload that is about to be superseded, which is
// the reason this protocol has no outbox.
func Push(ctx context.Context, client *http.Client, c Connector, report Report) error {
	report.Cap()
	body, err := json.Marshal(report)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, pushTimeout)
	defer cancel()

	url := strings.TrimSuffix(c.Sink, "/") + ReportPath
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("authorization", "Bearer "+c.Token)

	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("report to %s: %w", url, err)
	}
	defer res.Body.Close()
	// Drained so the connection can be reused: a body left unread makes every
	// report open a fresh TCP connection, which on a minute timer is a slow
	// leak of sockets against the sink.
	detail, _ := io.ReadAll(io.LimitReader(res.Body, 2048))

	switch {
	case res.StatusCode == http.StatusNoContent || res.StatusCode == http.StatusOK:
		return nil
	case res.StatusCode == http.StatusUnauthorized:
		// Named precisely, because the fix is a different command from every
		// other failure here: the token was rotated or the outpost deleted, and
		// no amount of retrying will change that.
		return fmt.Errorf(
			"%s rejected token %s — it was rotated or the outpost was deleted. "+
				"Mint a new one in Lore and run `bay connector add`", url, c.Prefix())
	default:
		return fmt.Errorf("%s answered %d: %s", url, res.StatusCode, strings.TrimSpace(string(detail)))
	}
}
