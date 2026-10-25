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

const loadAvgSample = "0.52 0.41 0.38 2/431 90210\n"

const uptimeSample = "123456.78 987654.32\n"

func TestParseProcStatCoresCountsThePerCoreLines(t *testing.T) {
	// The sample has one cpu0 line beside the aggregate.
	if got, ok := parseProcStatCores(procStatSample); !ok || got != 1 {
		t.Fatalf("parseProcStatCores = %v, %v; want 1, true", got, ok)
	}
	four := "cpu  1 2 3\ncpu0 1\ncpu1 1\ncpu2 1\ncpu3 1\nintr 5\n"
	if got, ok := parseProcStatCores(four); !ok || got != 4 {
		t.Fatalf("parseProcStatCores = %v, %v; want 4, true", got, ok)
	}
	// The aggregate line alone is not a core count, and neither is a file
	// with no cpu line at all.
	if _, ok := parseProcStatCores("cpu  1 2 3\nintr 5\n"); ok {
		t.Fatal("the aggregate line alone must not count as a core")
	}
	if _, ok := parseProcStatCores("intr 5\n"); ok {
		t.Fatal("a /proc/stat with no cpu line must answer nothing")
	}
	if _, ok := parseProcStatCores("cpufreq 1\n"); ok {
		t.Fatal("a cpu-prefixed line that names no core must not count")
	}
}

func TestParseMemInfoBytesKeepsTheBytes(t *testing.T) {
	total, used, ok := parseMemInfoBytes(memInfoSample)
	if !ok {
		t.Fatal("a meminfo with both lines must yield bytes")
	}
	if total != 8000000*1024 {
		t.Fatalf("total = %d, want %d", total, 8000000*1024)
	}
	// 8,000,000 kB total, 6,000,000 kB available: 2,000,000 kB used.
	if used != 2000000*1024 {
		t.Fatalf("used = %d, want %d", used, 2000000*1024)
	}
	if _, _, ok := parseMemInfoBytes("MemTotal:       10 kB\n"); ok {
		t.Fatal("a meminfo without MemAvailable must answer nothing")
	}
	if _, _, ok := parseMemInfoBytes("MemTotal: 10\nMemAvailable: 5\n"); ok {
		t.Fatal("a line without its unit column must be refused, not read as bytes")
	}
	// Available above total is a kernel that disagrees with itself; used is
	// clamped to zero rather than wrapping.
	total, used, ok = parseMemInfoBytes("MemTotal:  100 kB\nMemAvailable:  200 kB\n")
	if !ok || used != 0 || total != 100*1024 {
		t.Fatalf("clamped read = %d, %d, %v", total, used, ok)
	}
}

func TestParseLoadAvgAndUptimeTakeTheFirstColumn(t *testing.T) {
	if got, ok := parseLoadAvg(loadAvgSample); !ok || got != 0.52 {
		t.Fatalf("parseLoadAvg = %v, %v; want 0.52", got, ok)
	}
	if _, ok := parseLoadAvg(""); ok {
		t.Fatal("an empty /proc/loadavg must answer nothing")
	}
	if _, ok := parseLoadAvg("nope 1 2\n"); ok {
		t.Fatal("a non-numeric load must answer nothing")
	}
	// The second column is idle time summed over every core, and is not the
	// uptime.
	if got, ok := parseUptime(uptimeSample); !ok || got != 123456 {
		t.Fatalf("parseUptime = %v, %v; want 123456", got, ok)
	}
	if _, ok := parseUptime("-3 1\n"); ok {
		t.Fatal("a negative uptime must be refused, not wrapped into a century")
	}
}

func TestSanitizeLoadAndSecondsRefuseNonNumbers(t *testing.T) {
	if got, ok := sanitizeLoad(1.2345); !ok || got != 1.23 {
		t.Fatalf("sanitizeLoad = %v, %v; want 1.23", got, ok)
	}
	// A load average has no ceiling: 140 is a machine in trouble, not a
	// number to clamp to 100 the way a percentage is.
	if got, ok := sanitizeLoad(140); !ok || got != 140 {
		t.Fatalf("sanitizeLoad(140) = %v, %v; want 140", got, ok)
	}
	for _, v := range []float64{math.NaN(), math.Inf(1), -1} {
		if _, ok := sanitizeLoad(v); ok {
			t.Errorf("sanitizeLoad(%v) must be refused", v)
		}
		if _, ok := sanitizeSeconds(v); ok {
			t.Errorf("sanitizeSeconds(%v) must be refused", v)
		}
	}
}

func TestHostEmptyIsAbsentNotZero(t *testing.T) {
	if !(Host{}).Empty() {
		t.Fatal("a Host with no reading must be empty")
	}
	// bayVersion alone is not a reading of the machine: it is stamped by the
	// client and says nothing about /proc.
	if !(Host{BayVersion: "1.2.3"}).Empty() {
		t.Fatal("the version alone must not count as a reading")
	}
	cores := 4
	if (Host{Cores: &cores}).Empty() {
		t.Fatal("one field read is not empty")
	}
}
