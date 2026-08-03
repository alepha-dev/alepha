package connector

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStore(t *testing.T) {
	t.Run("an absent file is not an error", func(t *testing.T) {
		// A Bay that reports to nobody is the normal state — the whole point is
		// that it works standalone.
		list, err := NewStore(t.TempDir()).List()
		if err != nil || len(list) != 0 {
			t.Fatalf("want an empty list and no error, got %v %v", list, err)
		}
	})

	t.Run("adds and reads back", func(t *testing.T) {
		root := t.TempDir()
		store := NewStore(root)
		if err := store.Add(Connector{Sink: "https://lore.test", Token: "op_" + strings.Repeat("a", 32), Label: "OVH"}); err != nil {
			t.Fatal(err)
		}
		list, err := store.List()
		if err != nil || len(list) != 1 {
			t.Fatalf("want one connector, got %v %v", list, err)
		}
		if list[0].Label != "OVH" || list[0].Sink != "https://lore.test" {
			t.Fatalf("round trip lost fields: %+v", list[0])
		}
	})

	t.Run("writes the file 0600", func(t *testing.T) {
		// These are bearer tokens. Any wider and every local user reads them.
		root := t.TempDir()
		store := NewStore(root)
		if err := store.Add(Connector{Sink: "https://lore.test", Token: "op_x"}); err != nil {
			t.Fatal(err)
		}
		info, err := os.Stat(filepath.Join(root, FileName))
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != Mode {
			t.Fatalf("want %o, got %o", Mode, info.Mode().Perm())
		}
	})

	t.Run("refuses a sigil token", func(t *testing.T) {
		// The two credentials are pasted in different places and authorise
		// different things; catching the mix-up here beats a machine that
		// silently reports nowhere.
		err := NewStore(t.TempDir()).Add(Connector{Sink: "https://lore.test", Token: "sg_abc"})
		if err == nil || !strings.Contains(err.Error(), "op_") {
			t.Fatalf("want a message naming the expected prefix, got %v", err)
		}
	})

	t.Run("names a duplicate rather than deduplicating it", func(t *testing.T) {
		// Running the command twice usually means the operator thought the first
		// one failed. They should learn it worked, not get two reporters.
		store := NewStore(t.TempDir())
		entry := Connector{Sink: "https://lore.test", Token: "op_dup"}
		if err := store.Add(entry); err != nil {
			t.Fatal(err)
		}
		if err := store.Add(entry); err == nil {
			t.Fatal("want a refusal on the second add")
		}
	})

	t.Run("removes by prefix, because that is what list shows", func(t *testing.T) {
		store := NewStore(t.TempDir())
		token := "op_" + strings.Repeat("b", 32)
		if err := store.Add(Connector{Sink: "https://lore.test", Token: token}); err != nil {
			t.Fatal(err)
		}
		if _, err := store.Remove("op_bbb"); err != nil {
			t.Fatal(err)
		}
		list, _ := store.List()
		if len(list) != 0 {
			t.Fatalf("want it gone, got %v", list)
		}
		if _, err := store.Remove("op_nope"); err == nil {
			t.Fatal("want an error for a prefix that matches nothing")
		}
	})
}

func TestPrefixNeverPrintsTheToken(t *testing.T) {
	// Everything that displays a connector goes through this. A token echoed
	// into a terminal lives in a scrollback buffer and a support paste.
	full := "op_" + strings.Repeat("s", 32)
	got := Connector{Token: full}.Prefix()
	if strings.Contains(got, strings.Repeat("s", 20)) {
		t.Fatalf("the prefix leaked the token: %q", got)
	}
	if !strings.HasPrefix(got, "op_") {
		t.Fatalf("want it still recognisable, got %q", got)
	}
}

func TestDeployEvents(t *testing.T) {
	t.Run("derives a history from release directory names", func(t *testing.T) {
		// Nothing is written to disk to make this work — the names are already
		// timestamps, so an enrolled machine hands over its whole past.
		got := DeployEvents("lore", "production", []string{
			"2026-08-01-101500",
			"2026-08-03-093913",
		})
		if len(got) != 2 {
			t.Fatalf("want 2 events, got %d", len(got))
		}
		if got[0].OccurredAt != "2026-08-03T09:39:13Z" {
			t.Fatalf("want the newest first, got %q", got[0].OccurredAt)
		}
		if got[0].Kind != "deploy" || got[0].Release != "2026-08-03-093913" {
			t.Fatalf("wrong event: %+v", got[0])
		}
	})

	t.Run("skips a name it cannot parse instead of stamping 1970", func(t *testing.T) {
		// An event at the zero time sorts to the beginning of every chart
		// forever.
		got := DeployEvents("lore", "production", []string{"current", "not-a-date"})
		if len(got) != 0 {
			t.Fatalf("want nothing, got %+v", got)
		}
	})

	t.Run("reads through a collision suffix", func(t *testing.T) {
		// `uniqueRelease` appends to break a same-second collision; the stamp is
		// still the leading part.
		got := DeployEvents("lore", "production", []string{"2026-08-03-093913-2"})
		if len(got) != 1 || got[0].OccurredAt != "2026-08-03T09:39:13Z" {
			t.Fatalf("want the leading stamp read, got %+v", got)
		}
	})
}

func TestReportCap(t *testing.T) {
	// The sink refuses an over-long payload outright, and a report refused for
	// being too long looks exactly like a machine that went quiet.
	report := Report{}
	for i := 0; i < maxEvents+50; i++ {
		report.Events = append(report.Events, ReportEvent{
			OccurredAt: "2026-08-" + string(rune('0'+i%10)) + "T00:00:00Z",
		})
	}
	report.Cap()
	if len(report.Events) != maxEvents {
		t.Fatalf("want %d, got %d", maxEvents, len(report.Events))
	}
}

func TestPush(t *testing.T) {
	t.Run("sends the bearer and accepts 204", func(t *testing.T) {
		var seenAuth, seenPath string
		var body Report
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			seenAuth = r.Header.Get("authorization")
			seenPath = r.URL.Path
			raw, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(raw, &body)
			w.WriteHeader(http.StatusNoContent)
		}))
		defer srv.Close()

		err := Push(context.Background(), srv.Client(),
			Connector{Sink: srv.URL, Token: "op_secret"},
			Report{Apps: []ReportApp{{App: "lore", Environment: "production", Running: true}}})
		if err != nil {
			t.Fatal(err)
		}
		if seenAuth != "Bearer op_secret" {
			t.Fatalf("want the bearer, got %q", seenAuth)
		}
		if seenPath != ReportPath {
			t.Fatalf("want %s, got %s", ReportPath, seenPath)
		}
		if len(body.Apps) != 1 || body.Apps[0].App != "lore" {
			t.Fatalf("payload did not arrive intact: %+v", body)
		}
	})

	t.Run("tolerates a trailing slash on the sink", func(t *testing.T) {
		// An operator pasting a URL out of a browser brings one along.
		var seenPath string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			seenPath = r.URL.Path
			w.WriteHeader(http.StatusNoContent)
		}))
		defer srv.Close()
		if err := Push(context.Background(), srv.Client(),
			Connector{Sink: srv.URL + "/", Token: "op_x"}, Report{}); err != nil {
			t.Fatal(err)
		}
		if seenPath != ReportPath {
			t.Fatalf("want %s, got %s", ReportPath, seenPath)
		}
	})

	t.Run("names a 401 as the rotation it is", func(t *testing.T) {
		// The fix is a different command from every other failure here, and no
		// amount of retrying changes it.
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
		}))
		defer srv.Close()
		err := Push(context.Background(), srv.Client(),
			Connector{Sink: srv.URL, Token: "op_stale"}, Report{})
		if err == nil || !strings.Contains(err.Error(), "connector add") {
			t.Fatalf("want the remedy named, got %v", err)
		}
	})

	t.Run("reports the sink's own message on any other failure", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte("apps: too many items"))
		}))
		defer srv.Close()
		err := Push(context.Background(), srv.Client(),
			Connector{Sink: srv.URL, Token: "op_x"}, Report{})
		if err == nil || !strings.Contains(err.Error(), "too many items") {
			t.Fatalf("want the sink's explanation passed through, got %v", err)
		}
	})
}
