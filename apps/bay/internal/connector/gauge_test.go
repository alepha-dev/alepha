package connector

import (
	"math"
	"testing"
)

const procStatSample = `cpu  4705 150 1120 16250 520 0 30 0 0 0
cpu0 2352 75 560 8125 260 0 15 0 0 0
intr 12345
ctxt 6789
`

const memInfoSample = `MemTotal:        8000000 kB
MemFree:         1000000 kB
MemAvailable:    6000000 kB
Buffers:          200000 kB
`

func TestParseProcStatFoldsTheCpuLine(t *testing.T) {
	got, err := parseProcStat(procStatSample)
	if err != nil {
		t.Fatal(err)
	}
	// idle + iowait; total is the first eight columns, guest time excluded.
	if got.idle != 16250+520 {
		t.Fatalf("idle = %d", got.idle)
	}
	if got.total != 4705+150+1120+16250+520+0+30+0 {
		t.Fatalf("total = %d", got.total)
	}
	if _, err := parseProcStat("intr 1\n"); err == nil {
		t.Fatal("a /proc/stat with no cpu line must be an error, not zeros")
	}
	if _, err := parseProcStat("cpu a b c d e\n"); err == nil {
		t.Fatal("a non-numeric cpu line must be an error")
	}
}

func TestCpuPercentBetweenIsTheBusyShareOfTheDelta(t *testing.T) {
	prev := cpuTimes{idle: 100, total: 200}
	cur := cpuTimes{idle: 150, total: 400} // 200 ticks, 50 idle
	got, ok := cpuPercentBetween(prev, cur)
	if !ok || math.Abs(got-75) > 0.001 {
		t.Fatalf("cpuPercentBetween = %v, %v; want 75", got, ok)
	}
	if _, ok := cpuPercentBetween(cur, cur); ok {
		t.Fatal("no elapsed ticks must answer nothing, not 0%")
	}
	if _, ok := cpuPercentBetween(cur, prev); ok {
		t.Fatal("a counter that went backwards must answer nothing")
	}
}

func TestParseMemInfoUsesAvailableNotFree(t *testing.T) {
	got, err := parseMemInfo(memInfoSample)
	if err != nil {
		t.Fatal(err)
	}
	// 2,000,000 of 8,000,000 kB not available: 25%, not the 87.5% MemFree
	// alone would report on a host with a warm page cache.
	if math.Abs(got-25) > 0.001 {
		t.Fatalf("parseMemInfo = %v, want 25", got)
	}
	if _, err := parseMemInfo("MemTotal: 10 kB\n"); err == nil {
		t.Fatal("a meminfo without MemAvailable must be an error")
	}
}

func TestSanitizePercentRefusesNonNumbersAndClamps(t *testing.T) {
	cases := []struct {
		in   float64
		want float64
		ok   bool
	}{
		{34.56, 34.6, true},
		{-3, 0, true},
		{140, 100, true},
		{math.NaN(), 0, false},
		{math.Inf(1), 0, false},
	}
	for _, c := range cases {
		got, ok := sanitizePercent(c.in)
		if ok != c.ok || got != c.want {
			t.Errorf("sanitizePercent(%v) = %v, %v; want %v, %v", c.in, got, ok, c.want, c.ok)
		}
	}
}
