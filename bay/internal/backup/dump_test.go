package backup

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/alepha-dev/bay/internal/s3/s3test"
)

type fakeDumper struct {
	dump      []byte
	dumpErr   error
	verifyErr error
}

func (f fakeDumper) Dump(context.Context) ([]byte, error) { return f.dump, f.dumpErr }
func (f fakeDumper) Verify(context.Context, []byte) error { return f.verifyErr }

func TestBackupDump(t *testing.T) {
	t.Run("a verified dump is compressed, uploaded beside the snapshots, listed and fetched back", func(t *testing.T) {
		srv := s3test.New(t)
		m := New(srv.Client(t))
		dump := []byte(strings.Repeat("COPY public.kept (v) FROM stdin;\n", 100))
		res, err := m.BackupDump(context.Background(), "umami.db", "production", fakeDumper{dump: dump})
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(res.Key, "apps/umami.db-production/db/") || !strings.HasSuffix(res.Key, ".dump.gz") ||
			res.RawBytes != int64(len(dump)) || res.StoredBytes >= res.RawBytes {
			t.Fatalf("result = %+v", res)
		}
		entries, _ := m.List(context.Background(), "umami.db", "production")
		if len(entries) != 1 || entries[0].Key != res.Key {
			t.Fatalf("entries = %+v", entries)
		}
		back, err := m.FetchDump(context.Background(), res.Key, fakeDumper{})
		if err != nil || string(back) != string(dump) {
			t.Fatalf("fetched %d bytes, %v", len(back), err)
		}
	})

	t.Run("a failed, empty or unverifiable dump uploads nothing", func(t *testing.T) {
		srv := s3test.New(t)
		m := New(srv.Client(t))
		for want, d := range map[string]fakeDumper{
			"dump: boom":         {dumpErr: errors.New("boom")},
			"wrote nothing":      {},
			"verify: not a dump": {dump: []byte("x"), verifyErr: errors.New("not a dump")},
		} {
			if _, err := m.BackupDump(context.Background(), "umami.db", "production", d); err == nil || !strings.Contains(err.Error(), want) {
				t.Errorf("err = %v, want %q", err, want)
			}
		}
		if entries, _ := m.List(context.Background(), "umami.db", "production"); len(entries) != 0 {
			t.Fatalf("uploaded %+v", entries)
		}
	})
}
