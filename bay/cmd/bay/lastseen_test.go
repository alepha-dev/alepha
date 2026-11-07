package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/proxy"
)

/*
`bay status` read the traffic stamp from the store, which the proxy updates
only every lastSeenFlushInterval. An app that had answered several requests
seconds after its deploy therefore printed "never answered a request" (#Q3152).

Driven through the real proxy against a real backend, and asserted before any
flush: the listing must already see the request.
*/
func TestListAppsShowsTrafficTheStoreHasNotCaughtUpWith(t *testing.T) {
	f := deployedApp(t)

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(backend.Close)
	u, err := url.Parse(backend.URL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatal(err)
	}

	app := f.server.store.Apps()[0]
	app.Port = port
	if err := f.server.store.Upsert(app); err != nil {
		t.Fatal(err)
	}
	if len(app.Domains) == 0 {
		t.Fatal("the fixture app must have a domain to route by")
	}
	f.server.router = proxy.New(f.root, f.server.store, f.server.log)

	before := f.server.listApps()[0]
	if line := trafficLine(before, time.Now()); !strings.HasPrefix(line, "never") {
		t.Fatalf("no request yet, the line must say never: %q", line)
	}

	rec := httptest.NewRecorder()
	f.server.router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://"+app.Domains[0]+"/", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("the request must reach the app, got %d", rec.Code)
	}

	if stored := f.server.store.Apps()[0].LastRequestAt; stored != "" {
		t.Fatalf("the store must not have been flushed yet, or this proves nothing: %q", stored)
	}
	after := f.server.listApps()[0]
	if after.LastRequestAt == "" {
		t.Fatal("an app that answered a request must not read as never having answered one")
	}
	if line := trafficLine(after, time.Now()); strings.HasPrefix(line, "never") {
		t.Fatalf("traffic line = %q", line)
	}

	// Peeking must not eat the batch the flush loop persists.
	f.server.flushLastSeen()
	if f.server.store.Apps()[0].LastRequestAt == "" {
		t.Fatal("the flush must still persist what the listing showed")
	}
}

func TestNewerRequestStampKeepsTheLaterOfTheTwo(t *testing.T) {
	stored := time.Date(2026, 11, 6, 15, 0, 0, 0, time.UTC)

	cases := []struct {
		name      string
		stored    string
		unflushed time.Time
		want      string
	}{
		{"nothing unflushed keeps the store", stored.Format(time.RFC3339), time.Time{}, stored.Format(time.RFC3339)},
		{"a newer unflushed stamp wins", stored.Format(time.RFC3339), stored.Add(time.Minute), "2026-11-06T15:01:00Z"},
		{"an older unflushed stamp loses", stored.Format(time.RFC3339), stored.Add(-time.Minute), stored.Format(time.RFC3339)},
		{"nothing stored takes the unflushed one", "", stored, stored.Format(time.RFC3339)},
		{"an unreadable stored stamp is replaced", "garbage", stored, stored.Format(time.RFC3339)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := newerRequestStamp(tc.stored, tc.unflushed); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}
