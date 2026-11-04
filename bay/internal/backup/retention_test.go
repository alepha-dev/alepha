package backup

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/s3/s3test"
)

func at(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

// backupsEvery lays out n backups `step` apart, newest first, ending at last.
func backupsEvery(last time.Time, step time.Duration, n int) []Entry {
	out := make([]Entry, n)
	for i := range out {
		ts := last.Add(-time.Duration(i) * step)
		out[i] = Entry{Key: ts.Format(timeLayout), Timestamp: ts, Size: 100}
	}
	return out
}

func kept(plan []Decision) []string {
	var out []string
	for _, d := range plan {
		if d.Keep {
			out = append(out, d.Entry.Timestamp.UTC().Format("01-02T15"))
		}
	}
	return out
}

func TestParseStamp(t *testing.T) {
	for dir, want := range map[string]string{
		"20260801T030000Z":            "",
		"20260801T030000Z-pre-deploy": "pre-deploy",
		"20260801T030000Z-v2":         "v2",
	} {
		if _, tag, err := parseStamp(dir); err != nil || tag != want {
			t.Fatalf("%s: %q %v", dir, tag, err)
		}
	}
	for _, dir := range []string{"20260801T030000Z-", "20260801T030000Zx", "20260801T030000Z-Pre", "2026", "20260801T030000Z--a"} {
		if _, _, err := parseStamp(dir); err == nil {
			t.Fatalf("%s accepted", dir)
		}
	}
	if ValidTag(strings.Repeat("a", MaxTagLength+1)) == nil || ValidTag("a b") == nil || ValidTag("before-v2") != nil {
		t.Fatal("ValidTag")
	}
}

func TestRetentionKeepsTheNewestOfEachPeriod(t *testing.T) {
	// Every 6 hours over 10 days: 40 backups.
	entries := backupsEvery(at("2026-08-10T18:00:00Z"), 6*time.Hour, 40)
	plan := PlanRetention(entries, nil, Rules{Keep: 2, Daily: 3}, at("2026-08-10T19:00:00Z"))
	got := strings.Join(kept(plan), " ")
	if got != "08-10T18 08-10T12 08-09T18 08-08T18" {
		t.Fatalf("kept %s", got)
	}
	if r := strings.Join(plan[0].Reasons, ","); r != "last 2,daily 2026-08-10,newest" {
		t.Fatalf("reasons %s", r)
	}
	if plan[39].Keep || plan[39].Reasons[0] != "no rule keeps it" {
		t.Fatalf("oldest %+v", plan[39])
	}
}

func TestRetentionPeriodsFollowTheTimezone(t *testing.T) {
	// 23:30 UTC is already the next day in Paris.
	entries := []Entry{
		{Timestamp: at("2026-08-10T23:30:00Z"), Size: 1},
		{Timestamp: at("2026-08-10T21:00:00Z"), Size: 1},
		{Timestamp: at("2026-08-10T10:00:00Z"), Size: 1},
	}
	paris, _ := time.LoadLocation("Europe/Paris")
	plan := PlanRetention(entries, nil, Rules{Daily: 2, Location: paris}, at("2026-08-11T00:00:00Z"))
	if got := strings.Join(kept(plan), " "); got != "08-10T23 08-10T21" {
		t.Fatalf("Paris: kept %s", got)
	}
	plan = PlanRetention(entries, nil, Rules{Daily: 2}, at("2026-08-11T00:00:00Z"))
	if got := strings.Join(kept(plan), " "); got != "08-10T23" {
		t.Fatalf("UTC: kept %s", got)
	}
}

func TestRetentionWeeklyMonthlyYearly(t *testing.T) {
	entries := backupsEvery(at("2026-08-10T03:00:00Z"), 24*time.Hour, 800)
	plan := PlanRetention(entries, nil, Rules{Weekly: 2, Monthly: 2, Yearly: 3}, at("2026-08-10T04:00:00Z"))
	// Monday 08-10 starts a week; the week before ends on Sunday 08-09.
	// Months: 08-10, 07-31. Years: 2026-08-10, 2025-12-31, 2024-12-31.
	if got := strings.Join(kept(plan), " "); got != "08-10T03 08-09T03 07-31T03 12-31T03 12-31T03" {
		t.Fatalf("kept %s", got)
	}
}

func TestRetentionMaxAgeCapsEverythingButTheNewest(t *testing.T) {
	entries := backupsEvery(at("2026-08-10T03:00:00Z"), 24*time.Hour, 30)
	plan := PlanRetention(entries, nil, Rules{Daily: 30, MaxAge: 7 * 24 * time.Hour}, at("2026-08-10T04:00:00Z"))
	if n := len(kept(plan)); n != 7 {
		t.Fatalf("kept %d", n)
	}
	if plan[10].Reasons[0] != "older than 7d" {
		t.Fatalf("reason %v", plan[10].Reasons)
	}
	// Bay stopped backing up a month ago: the last backup still stays.
	old := backupsEvery(at("2026-07-01T03:00:00Z"), 24*time.Hour, 3)
	plan = PlanRetention(old, nil, Rules{Keep: 3, MaxAge: 7 * 24 * time.Hour}, at("2026-08-10T04:00:00Z"))
	if got := strings.Join(kept(plan), " "); got != "07-01T03" {
		t.Fatalf("kept %s", got)
	}
}

func TestRetentionPoolsPreDeployAndTagged(t *testing.T) {
	entries := []Entry{
		{Timestamp: at("2026-08-10T05:00:00Z"), Tag: TagPreDeploy, Size: 1},
		{Timestamp: at("2026-08-10T04:00:00Z"), Tag: TagPreDeploy, Size: 1},
		{Timestamp: at("2026-08-10T03:00:00Z"), Size: 1},
		{Timestamp: at("2026-08-10T02:00:00Z"), Tag: "before-v2", Size: 1},
		{Timestamp: at("2026-08-10T01:00:00Z"), Size: 1},
		{Timestamp: at("2026-01-01T01:00:00Z"), Tag: "launch", Size: 1},
	}
	r := Rules{Keep: 1, KeepPreDeploy: 1, KeepTagged: true, MaxAge: 30 * 24 * time.Hour}
	plan := PlanRetention(entries, nil, r, at("2026-08-10T06:00:00Z"))
	// The pre-deploy burst does not push the ordinary backup out.
	if got := strings.Join(kept(plan), " "); got != "08-10T05 08-10T03 08-10T02 01-01T01" {
		t.Fatalf("kept %s", got)
	}
	r.KeepTagged = false
	plan = PlanRetention(entries, nil, r, at("2026-08-10T06:00:00Z"))
	if got := strings.Join(kept(plan), " "); got != "08-10T05 08-10T03" {
		t.Fatalf("untagged: kept %s", got)
	}
}

func TestRetentionProtectsTheLastNormalSize(t *testing.T) {
	entries := backupsEvery(at("2026-08-10T03:00:00Z"), 24*time.Hour, 6)
	// Shrinking a little each day: 100 → 40 → 15 → 10.
	entries[0].Size, entries[1].Size, entries[2].Size = 10, 15, 40
	plan := PlanRetention(entries, nil, Rules{Keep: 2}, at("2026-08-10T04:00:00Z"))
	if got := strings.Join(kept(plan), " "); got != "08-10T03 08-09T03 08-07T03" {
		t.Fatalf("kept %s", got)
	}
	if r := plan[3].Reasons; len(r) != 1 || r[0] != "last backup of normal size" {
		t.Fatalf("reasons %v", r)
	}
	// A month later the cleanup is taken as deliberate.
	plan = PlanRetention(entries, nil, Rules{Keep: 2}, at("2026-09-10T04:00:00Z"))
	if n := len(kept(plan)); n != 2 {
		t.Fatalf("a month later: kept %d", n)
	}
	// Steady sizes: nothing extra.
	plan = PlanRetention(backupsEvery(at("2026-08-10T03:00:00Z"), 24*time.Hour, 4), nil, Rules{Keep: 2}, at("2026-08-10T04:00:00Z"))
	if n := len(kept(plan)); n != 2 {
		t.Fatalf("kept %d", n)
	}
}

func TestRetentionIncompleteBundles(t *testing.T) {
	entries := backupsEvery(at("2026-08-10T03:00:00Z"), 24*time.Hour, 3)
	incomplete := []Entry{{Timestamp: at("2026-08-10T04:00:00Z")}, {Timestamp: at("2026-08-01T03:00:00Z")}}
	plan := PlanRetention(entries, incomplete, Rules{Keep: 2}, at("2026-08-10T05:00:00Z"))
	if d := plan[3]; !d.Keep || !d.Incomplete {
		t.Fatalf("running upload %+v", d)
	}
	if d := plan[4]; d.Keep || d.Reasons[0] != "incomplete upload" {
		t.Fatalf("dead upload %+v", d)
	}

	// Older than the oldest kept but under a day old: another Bay on the
	// same prefix may still be uploading it.
	recent := []Entry{{Timestamp: at("2026-08-08T02:00:00Z")}}
	plan = PlanRetention(entries, recent, Rules{Keep: 1}, at("2026-08-08T20:00:00Z"))
	if d := plan[len(plan)-1]; !d.Keep || !d.Incomplete {
		t.Fatalf("an incomplete bundle under a day old must be left alone: %+v", d)
	}
}

func TestPruneDeletesTaggedBundlesByThePlan(t *testing.T) {
	srv := s3test.New(t)
	for _, dir := range []string{"20260801T000000Z", "20260802T000000Z-pre-deploy", "20260803T000000Z-pre-deploy", "20260804T000000Z"} {
		srv.Seed(prefix+dir+"/files/app.db.gz", []byte("x"))
		srv.Seed(prefix+dir+"/"+manifestName, []byte("{}"))
	}
	m := New(srv.Client(t))
	entries, err := m.List(context.Background(), "lore", "production")
	if err != nil || len(entries) != 4 || entries[1].Tag != TagPreDeploy {
		t.Fatalf("list %+v %v", entries, err)
	}
	removed, err := m.Prune(context.Background(), "lore", "production", Rules{Keep: 1, KeepPreDeploy: 1})
	if err != nil || len(removed) != 2 {
		t.Fatalf("removed %+v %v", removed, err)
	}
	if got := strings.Join(srv.Keys(), ","); strings.Contains(got, "20260801") || strings.Contains(got, "20260802") || !strings.Contains(got, "20260803T000000Z-pre-deploy/") {
		t.Fatalf("bucket %s", got)
	}
	if key, _, err := RestoreKey("lore", "production", "20260803T000000Z-pre-deploy"); err != nil || !strings.HasSuffix(key, "-pre-deploy/"+manifestName) {
		t.Fatalf("restore key %s %v", key, err)
	}
}
