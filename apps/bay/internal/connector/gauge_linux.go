//go:build linux

package connector

import (
	"context"
	"os"
	"sync"
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
	// warmup bounds the first sample's wait for a delta.
	warmup time.Duration
}

// HostGauge reads the machine through /proc.
func HostGauge() Gauge {
	return &procGauge{readFile: os.ReadFile, warmup: 500 * time.Millisecond}
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
	return Reading{CPUPercent: cpu, MemoryPercent: mem}, true
}

func (g *procGauge) cpu() (cpuTimes, error) {
	raw, err := g.readFile("/proc/stat")
	if err != nil {
		return cpuTimes{}, err
	}
	return parseProcStat(string(raw))
}
