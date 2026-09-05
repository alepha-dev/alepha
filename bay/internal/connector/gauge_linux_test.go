//go:build linux

package connector

import (
	"context"
	"errors"
	"testing"
	"time"
)

// fakeProc answers /proc/stat with a moving counter and /proc/meminfo with a
// fixed page, so the delta is deterministic.
type fakeProc struct{ reads int }

func (p *fakeProc) read(path string) ([]byte, error) {
	switch path {
	case "/proc/stat":
		p.reads++
		if p.reads == 1 {
			return []byte("cpu  100 0 0 100 0 0 0 0 0 0\n"), nil
		}
		// 200 more ticks, 50 of them idle: 75% busy.
		return []byte("cpu  250 0 0 150 0 0 0 0 0 0\n"), nil
	case "/proc/meminfo":
		return []byte(memInfoSample), nil
	}
	return nil, errors.New("no such file")
}

func TestProcGaugeTakesADeltaAndReadsMemory(t *testing.T) {
	p := &fakeProc{}
	g := &procGauge{readFile: p.read, warmup: time.Millisecond}
	r, ok := g.Sample(context.Background())
	if !ok {
		t.Fatal("a readable /proc must yield a reading")
	}
	if r.CPUPercent < 74.9 || r.CPUPercent > 75.1 {
		t.Fatalf("CPUPercent = %v, want 75", r.CPUPercent)
	}
	if r.MemoryPercent < 24.9 || r.MemoryPercent > 25.1 {
		t.Fatalf("MemoryPercent = %v, want 25", r.MemoryPercent)
	}
	// A second sample in the same tick has no delta and says nothing rather
	// than 0%.
	if _, ok := g.Sample(context.Background()); ok {
		t.Fatal("no elapsed ticks must answer nothing")
	}
}

func TestProcGaugeSaysNothingWithoutProc(t *testing.T) {
	g := &procGauge{readFile: func(string) ([]byte, error) { return nil, errors.New("no /proc") }, warmup: time.Millisecond}
	if _, ok := g.Sample(context.Background()); ok {
		t.Fatal("an unreadable /proc must yield nothing, never zeros")
	}
}

func TestHostGaugeReadsTheRealMachine(t *testing.T) {
	// The container: a real /proc, a real delta, values inside the gauge.
	r, ok := HostGauge().Sample(context.Background())
	if !ok {
		t.Fatal("the real /proc must yield a reading on linux")
	}
	if r.CPUPercent < 0 || r.CPUPercent > 100 || r.MemoryPercent <= 0 || r.MemoryPercent > 100 {
		t.Fatalf("reading out of range: %+v", r)
	}
}
