package connector

import (
	"context"
	"errors"
	"math"
	"strconv"
	"strings"
)

// Reading is the host gauge at one instant: percentages of the whole machine,
// and the absolute facts beside them.
type Reading struct {
	CPUPercent    float64
	MemoryPercent float64
	Host          Host
}

/*
Host is the machine in absolute units, which is what a console renders.

"CPU 65%" is a fine list badge and a useless machine console: the headline
number wanted is "5.2 GB of 8 GB", and a percentage cannot produce it.

Every field is a pointer and every field is independently optional: one
unreadable file under /proc drops that field and leaves the rest. Absent
rather than zero, for the reason Sample's doc gives, and the JSON tags carry
that through to the wire, where the whole block is optional too.

BayVersion is the exception: the gauge never reads it. `version` is a package
main variable stamped at link time and internal/connector cannot import main,
so it enters as Client.Version and is stamped on the frame.
*/
type Host struct {
	Cores          *int     `json:"cores,omitempty"`
	MemTotalBytes  *uint64  `json:"memTotalBytes,omitempty"`
	MemUsedBytes   *uint64  `json:"memUsedBytes,omitempty"`
	DiskTotalBytes *uint64  `json:"diskTotalBytes,omitempty"`
	DiskUsedBytes  *uint64  `json:"diskUsedBytes,omitempty"`
	Load1          *float64 `json:"load1,omitempty"`
	UptimeSeconds  *uint64  `json:"uptimeSeconds,omitempty"`
	BayVersion     string   `json:"bayVersion,omitempty"`
}

// Empty reports a Host that carries no reading at all, which is what a
// machine without /proc answers.
func (h Host) Empty() bool {
	return h.Cores == nil && h.MemTotalBytes == nil && h.MemUsedBytes == nil &&
		h.DiskTotalBytes == nil && h.DiskUsedBytes == nil && h.Load1 == nil &&
		h.UptimeSeconds == nil
}

/*
Gauge reads the host, not an app.

`runner.Usage` reads one app's cgroup; this is the machine: CPU as the busy
share of every core since the previous sample, memory as what is not
available. The estate list renders it as "CPU 34%", so it is a gauge and never
a series on this side; what Lore keeps of it is Lore's decision (#1627).

Sample answers false when it has nothing to say: on a host without /proc, or
on the first call before there is a previous sample to take a delta from.
Nothing rather than zeros, for the reason `Usage`'s doc gives: zero reads as
a fact, and "CPU 0%" beside an online estate is a lie, not an absence.

Host is the same instant read in absolute units, and it is a second method
rather than a field of a Reading because the two have different rules. The
percentages need a delta and the first call waits for one; memory, disk, cores
and uptime need nothing of the sort and must not be held hostage to it, so the
inventory push reads them directly and carries them on the very first frame.
*/
type Gauge interface {
	Sample(ctx context.Context) (Reading, bool)
	Host(ctx context.Context) (Host, bool)
}

// cpuTimes is one line of /proc/stat, folded to the two numbers a delta needs.
type cpuTimes struct {
	idle  uint64
	total uint64
}

// parseProcStat reads the aggregate `cpu` line of /proc/stat.
//
// Fields, per proc(5): user nice system idle iowait irq softirq steal guest
// guest_nice. Idle time is idle plus iowait; total is everything but the two
// guest columns, which are already counted inside user and nice.
func parseProcStat(raw string) (cpuTimes, error) {
	for _, line := range strings.Split(raw, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 5 || fields[0] != "cpu" {
			continue
		}
		var values []uint64
		for _, f := range fields[1:] {
			v, err := strconv.ParseUint(f, 10, 64)
			if err != nil {
				return cpuTimes{}, errors.New("/proc/stat cpu line is not numeric")
			}
			values = append(values, v)
		}
		var t cpuTimes
		for i, v := range values {
			if i >= 8 {
				break // guest, guest_nice
			}
			t.total += v
			if i == 3 || i == 4 {
				t.idle += v
			}
		}
		return t, nil
	}
	return cpuTimes{}, errors.New("/proc/stat has no cpu line")
}

// cpuPercentBetween is the busy share between two samples, or false when the
// clock did not move (two reads in the same tick, or a counter reset).
func cpuPercentBetween(prev, cur cpuTimes) (float64, bool) {
	if cur.total <= prev.total || cur.idle < prev.idle {
		return 0, false
	}
	total := float64(cur.total - prev.total)
	idle := float64(cur.idle - prev.idle)
	if idle > total {
		return 0, false
	}
	return 100 * (total - idle) / total, true
}

// parseMemInfo reads MemTotal and MemAvailable from /proc/meminfo and
// answers the used share.
//
// MemAvailable, not MemFree: the kernel's own estimate of what can be handed
// to a new process without swapping, which counts reclaimable cache as
// available. MemFree alone reads a healthy host with a warm page cache as
// nearly full.
func parseMemInfo(raw string) (float64, error) {
	var total, available uint64
	var haveTotal, haveAvailable bool
	for _, line := range strings.Split(raw, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		v, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			total, haveTotal = v, true
		case "MemAvailable:":
			available, haveAvailable = v, true
		}
	}
	if !haveTotal || !haveAvailable || total == 0 {
		return 0, errors.New("/proc/meminfo has no MemTotal and MemAvailable")
	}
	if available > total {
		available = total
	}
	return 100 * float64(total-available) / float64(total), nil
}

// parseProcStatCores counts the per-core lines of /proc/stat.
//
// The aggregate `cpu` line is already parsed for the delta and the `cpuN`
// lines beside it are discarded; counting them is the core count, with no
// second file to read. Zero cores is not a machine, so it answers false.
func parseProcStatCores(raw string) (int, bool) {
	cores := 0
	for _, line := range strings.Split(raw, "\n") {
		name, _, found := strings.Cut(line, " ")
		if !found || len(name) <= 3 || !strings.HasPrefix(name, "cpu") {
			continue
		}
		if _, err := strconv.ParseUint(name[3:], 10, 32); err == nil {
			cores++
		}
	}
	return cores, cores > 0
}

// parseMemInfoBytes reads MemTotal and MemAvailable as bytes.
//
// The same two lines parseMemInfo folds into a share, kept whole this time:
// the percentage is what the estate list badge shows, the bytes are what the
// console headline needs, and one is not derivable from the other.
//
// /proc/meminfo counts in kB, which is what the unit column says on every
// line; a line without it is refused rather than read as bytes.
func parseMemInfoBytes(raw string) (total, used uint64, ok bool) {
	var available uint64
	var haveTotal, haveAvailable bool
	for _, line := range strings.Split(raw, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 || fields[2] != "kB" {
			continue
		}
		v, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil || v > math.MaxUint64/1024 {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			total, haveTotal = v*1024, true
		case "MemAvailable:":
			available, haveAvailable = v*1024, true
		}
	}
	if !haveTotal || !haveAvailable || total == 0 {
		return 0, 0, false
	}
	if available > total {
		available = total
	}
	return total, total - available, true
}

// parseLoadAvg reads the one-minute load from /proc/loadavg.
func parseLoadAvg(raw string) (float64, bool) {
	fields := strings.Fields(raw)
	if len(fields) == 0 {
		return 0, false
	}
	v, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0, false
	}
	return sanitizeLoad(v)
}

// parseUptime reads the first column of /proc/uptime, the seconds since boot.
// The second column is idle time summed over every core and is not wanted.
func parseUptime(raw string) (uint64, bool) {
	fields := strings.Fields(raw)
	if len(fields) == 0 {
		return 0, false
	}
	v, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0, false
	}
	return sanitizeSeconds(v)
}

// sanitizeLoad is sanitizePercent's rule for a number with no ceiling: NaN,
// infinities and negatives are refused, and what is left is rounded to a
// hundredth. A load average is unbounded above, so it is never clamped.
func sanitizeLoad(v float64) (float64, bool) {
	if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
		return 0, false
	}
	return math.Round(v*100) / 100, true
}

// sanitizeSeconds is the same refusal for a duration crossing into uint64,
// where a negative would wrap into a century rather than fail.
func sanitizeSeconds(v float64) (uint64, bool) {
	if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 || v > math.MaxInt64 {
		return 0, false
	}
	return uint64(v), true
}

// sanitizePercent is the last thing between a reading and the wire: NaN and
// infinities are refused, anything else is clamped to the gauge's range and
// rounded to a tenth, which is all the estate list shows.
func sanitizePercent(v float64) (float64, bool) {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0, false
	}
	v = math.Max(0, math.Min(100, v))
	return math.Round(v*10) / 10, true
}
