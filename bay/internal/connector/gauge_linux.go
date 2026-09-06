//go:build linux

package connector

import (
	"context"
	"os"
	"sync"
	"syscall"
	"time"
)

// procGauge reads /proc. The CPU figure is a delta, so the first sample has
// no previous reading to compare with and waits a short window to take one:
// the alternative, answering the busy share since boot, is a number that
// means nothing about now.
type procGauge struct {
	mu   sync.Mutex
	prev *cpuTimes
	// readFile is a seam for the tests that feed a /proc of their own.
	readFile func(string) ([]byte, error)
	// diskUsage is a seam over statfs, for the same reason.
	diskUsage func(string) (total, used uint64, err error)
	// root is the directory the disk figure describes: the Bay root, since
	// what fills up on this machine is releases and backups, not /.
	root string
	// warmup bounds the first sample's wait for a delta.
	warmup time.Duration
}

// HostGauge reads the machine through /proc, and the filesystem holding the
// Bay root through statfs.
func HostGauge(root string) Gauge {
	return &procGauge{
		readFile:  os.ReadFile,
		diskUsage: statfsUsage,
		root:      root,
		warmup:    500 * time.Millisecond,
	}
}

func (g *procGauge) Sample(ctx context.Context) (Reading, bool) {
	g.mu.Lock()
	defer g.mu.Unlock()

	cur, err := g.cpu()
	if err != nil {
		return Reading{}, false
	}
	if g.prev == nil {
		// A copy: cur is reassigned by the second read below, and a pointer
		// to it would compare the new sample with itself.
		first := cur
		g.prev = &first
		select {
		case <-ctx.Done():
			return Reading{}, false
		case <-time.After(g.warmup):
		}
		if cur, err = g.cpu(); err != nil {
			return Reading{}, false
		}
	}
	cpu, ok := cpuPercentBetween(*g.prev, cur)
	g.prev = &cur
	if !ok {
		return Reading{}, false
	}

	raw, err := g.readFile("/proc/meminfo")
	if err != nil {
		return Reading{}, false
	}
	mem, err := parseMemInfo(string(raw))
	if err != nil {
		return Reading{}, false
	}
	host, _ := g.host()
	return Reading{CPUPercent: cpu, MemoryPercent: mem, Host: host}, true
}

// Host reads the absolutes, every call, taking no delta and waiting for
// nothing. It never touches g.prev, so it is safe beside a Sample in flight
// and cannot disturb the CPU series.
func (g *procGauge) Host(context.Context) (Host, bool) {
	return g.host()
}

/*
host reads each fact independently.

Every read stands alone on purpose: a container with no /proc/loadavg, or a
Bay root on a filesystem statfs refuses, drops that one field and keeps the
rest. The alternative, one error abandoning the whole block, would lose the
memory headline over a missing uptime file.
*/
func (g *procGauge) host() (Host, bool) {
	var h Host
	if raw, err := g.readFile("/proc/stat"); err == nil {
		if cores, ok := parseProcStatCores(string(raw)); ok {
			h.Cores = &cores
		}
	}
	if raw, err := g.readFile("/proc/meminfo"); err == nil {
		if total, used, ok := parseMemInfoBytes(string(raw)); ok {
			h.MemTotalBytes, h.MemUsedBytes = &total, &used
		}
	}
	if g.diskUsage != nil {
		if total, used, err := g.diskUsage(g.root); err == nil && total > 0 {
			h.DiskTotalBytes, h.DiskUsedBytes = &total, &used
		}
	}
	if raw, err := g.readFile("/proc/loadavg"); err == nil {
		if load, ok := parseLoadAvg(string(raw)); ok {
			h.Load1 = &load
		}
	}
	if raw, err := g.readFile("/proc/uptime"); err == nil {
		if up, ok := parseUptime(string(raw)); ok {
			h.UptimeSeconds = &up
		}
	}
	return h, !h.Empty()
}

func (g *procGauge) cpu() (cpuTimes, error) {
	raw, err := g.readFile("/proc/stat")
	if err != nil {
		return cpuTimes{}, err
	}
	return parseProcStat(string(raw))
}

// statfsUsage answers the size of the filesystem holding path, and how much
// of it is gone.
//
// Blocks minus Bfree rather than minus Bavail: the reserved blocks an
// unprivileged process cannot touch are used space from the disk's point of
// view, and Bay runs as root anyway.
func statfsUsage(path string) (total, used uint64, err error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0, err
	}
	if st.Bsize <= 0 {
		return 0, 0, syscall.EINVAL
	}
	size := uint64(st.Bsize)
	return st.Blocks * size, (st.Blocks - st.Bfree) * size, nil
}
