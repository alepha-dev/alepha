package connector

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// EnrolmentPrefix marks a one-time enrolment secret (#Q3165 in the Alepha
// project): the one a server provisioned by `lore estate provision` finds in
// its cloud-init user data. It is never stored and never dials the socket:
// `bay connector set` exchanges it first, over HTTPS, for the estate's
// long-lived secret, and stores that. User data is readable through the
// metadata service, so what sits there must be worthless once used; Lore
// retires it on the first dial made with the secret it was exchanged for.
const EnrolmentPrefix = "enr_"

// EnrolPath is Lore's exchange route, a root path like the pull routes.
const EnrolPath = "/estates/enrol"

// IsEnrolment says whether a secret is a one-time enrolment secret.
func IsEnrolment(secret string) bool {
	return strings.HasPrefix(secret, EnrolmentPrefix) && len(secret) > len(EnrolmentPrefix)
}

// Enrolled is what the exchange answers: the long-lived secret and the slug
// of the estate it belongs to.
type Enrolled struct {
	Secret string `json:"secret"`
	Slug   string `json:"slug"`
}

// Exchange trades an enrolment secret for the estate's long-lived one. The
// sink must already be validated (ValidateSink), so the enrolment secret
// never crosses the network in clear. Every accepted call mints a new
// long-lived secret on Lore's side, which is what makes a retry after a
// crash safe. Neither secret appears in an error.
func Exchange(ctx context.Context, client *http.Client, sink, enrolment string) (Enrolled, error) {
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(sink, "/")+EnrolPath, nil)
	if err != nil {
		return Enrolled{}, err
	}
	req.Header.Set("Authorization", "Bearer "+enrolment)
	res, err := client.Do(req)
	if err != nil {
		return Enrolled{}, fmt.Errorf("could not reach %s to exchange the enrolment secret: %w", sink, err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if res.StatusCode == http.StatusUnauthorized {
		return Enrolled{}, errors.New("Lore refused the enrolment secret: it is unknown, already used, or expired (they last 30 minutes). " +
			"Mint a new one, or enrol with the estate's own secret: lore estate rotate <slug>")
	}
	if res.StatusCode != http.StatusOK {
		return Enrolled{}, fmt.Errorf("the enrolment exchange answered %d", res.StatusCode)
	}
	var out Enrolled
	if err := json.Unmarshal(body, &out); err != nil {
		return Enrolled{}, fmt.Errorf("the enrolment exchange answered something unreadable: %w", err)
	}
	if err := ValidateSecret(out.Secret); err != nil {
		return Enrolled{}, errors.New("the enrolment exchange answered no estate secret")
	}
	return out, nil
}
