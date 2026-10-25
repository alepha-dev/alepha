package backup

import (
	"testing"
	"time"
)

// `List` decides what "latest" means, and `Prune` decides what to delete, and
// both do it by reading a timestamp back out of the object key. A key this
// cannot parse is skipped — so a parser that is too permissive would hand
// `Prune` an object nobody here wrote, and a parser that is too strict would
// quietly hide real backups and make `bay status` report the last one as older
// than it is.
//
// The equivalent test for the storage archives went out with them; this is the
// half that still runs.
func TestParseKeyTime(t *testing.T) {
	t.Run("reads the stamp off a database backup", func(t *testing.T) {
		got, err := parseKeyTime("apps/lore/production/db/20260803T120000Z.sqlite.gz")
		if err != nil {
			t.Fatal(err)
		}
		if !got.Equal(time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)) {
			t.Fatalf("want 2026-08-03T12:00:00Z, got %v", got)
		}
	})

	t.Run("refuses a key nobody here wrote", func(t *testing.T) {
		// The bucket is shared with whatever else an operator puts in it, and
		// with the app blobs Bay now writes under `apps/<name>/<env>/blobs/`.
		// Skipped rather than guessed at.
		if _, err := parseKeyTime("apps/lore/production/db/notes.txt"); err == nil {
			t.Fatal("want an error for a key with no backup suffix")
		}
	})

	t.Run("refuses a well-suffixed key with an unparseable stamp", func(t *testing.T) {
		if _, err := parseKeyTime("apps/lore/production/db/yesterday.sqlite.gz"); err == nil {
			t.Fatal("want an error rather than a zero time treated as 'very old'")
		}
	})
}
