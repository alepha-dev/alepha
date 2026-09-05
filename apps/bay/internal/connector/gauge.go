package connector

import (
	"context"
	"errors"
	"math"
	"strconv"
	"strings"
)

// Reading is the host gauge at one instant: percentages of the whole machine.
type Reading struct {
	CPUPercent    float64
	MemoryPercent float64
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
*/
type Gauge interface {
	Sample(ctx context.Context) (Reading, bool)
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
