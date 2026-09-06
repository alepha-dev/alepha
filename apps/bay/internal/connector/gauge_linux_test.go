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
	r, ok := HostGauge(t.TempDir()).Sample(context.Background())
	if !ok {
		t.Fatal("the real /proc must yield a reading on linux")
	}
	if r.CPUPercent < 0 || r.CPUPercent > 100 || r.MemoryPercent <= 0 || r.MemoryPercent > 100 {
		t.Fatalf("reading out of range: %+v", r)
	}
}

// fakeHost answers a whole /proc, with a set of paths that fail.
type fakeHost struct {
	missing map[string]bool
	statfs  func(string) (uint64, uint64, error)
}

func (p *fakeHost) read(path string) ([]byte, error) {
	if p.missing[path] {
		return nil, errors.New("no such file")
	}
	switch path {
	case "/proc/stat":
		return []byte(procStatSample), nil
	case "/proc/meminfo":
		return []byte(memInfoSample), nil
	case "/proc/loadavg":
		return []byte(loadAvgSample), nil
	case "/proc/uptime":
		return []byte(uptimeSample), nil
	}
	return nil, errors.New("no such file")
}

func newFakeHostGauge(missing ...string) (*procGauge, *fakeHost) {
	p := &fakeHost{missing: map[string]bool{}}
	for _, m := range missing {
		p.missing[m] = true
	}
	p.statfs = func(string) (uint64, uint64, error) { return 500 * 1024 * 1024 * 1024, 120 * 1024 * 1024 * 1024, nil }
	g := &procGauge{readFile: p.read, diskUsage: func(path string) (uint64, uint64, error) {
		return p.statfs(path)
	}, root: "/opt/bay/data", warmup: time.Millisecond}
	return g, p
}

func TestHostReadsTheAbsolutes(t *testing.T) {
	g, _ := newFakeHostGauge()
	h, ok := g.Host(context.Background())
	if !ok {
		t.Fatal("a readable /proc must yield a host reading")
	}
	if h.Cores == nil || *h.Cores != 1 {
		t.Fatalf("cores = %v", h.Cores)
	}
	if h.MemTotalBytes == nil || *h.MemTotalBytes != 8000000*1024 {
		t.Fatalf("memTotalBytes = %v", h.MemTotalBytes)
	}
	if h.MemUsedBytes == nil || *h.MemUsedBytes != 2000000*1024 {
		t.Fatalf("memUsedBytes = %v", h.MemUsedBytes)
	}
	if h.DiskTotalBytes == nil || *h.DiskTotalBytes != 500*1024*1024*1024 {
		t.Fatalf("diskTotalBytes = %v", h.DiskTotalBytes)
	}
	if h.DiskUsedBytes == nil || *h.DiskUsedBytes != 120*1024*1024*1024 {
		t.Fatalf("diskUsedBytes = %v", h.DiskUsedBytes)
	}
	if h.Load1 == nil || *h.Load1 != 0.52 {
		t.Fatalf("load1 = %v", h.Load1)
	}
	if h.UptimeSeconds == nil || *h.UptimeSeconds != 123456 {
		t.Fatalf("uptimeSeconds = %v", h.UptimeSeconds)
	}
	// The gauge never reads the version: it enters as Client.Version.
	if h.BayVersion != "" {
		t.Fatalf("the gauge must not invent a version: %q", h.BayVersion)
	}
}

func TestHostFieldsAreIndependentlyOptional(t *testing.T) {
	cases := []struct {
		name    string
		missing []string
		absent  func(Host) bool
		present func(Host) bool
	}{
		{"no loadavg", []string{"/proc/loadavg"},
			func(h Host) bool { return h.Load1 == nil },
			func(h Host) bool { return h.MemTotalBytes != nil && h.Cores != nil && h.UptimeSeconds != nil }},
		{"no uptime", []string{"/proc/uptime"},
			func(h Host) bool { return h.UptimeSeconds == nil },
			func(h Host) bool { return h.MemTotalBytes != nil && h.Load1 != nil }},
		{"no meminfo", []string{"/proc/meminfo"},
			func(h Host) bool { return h.MemTotalBytes == nil && h.MemUsedBytes == nil },
			func(h Host) bool { return h.Cores != nil && h.DiskTotalBytes != nil }},
		{"no stat", []string{"/proc/stat"},
			func(h Host) bool { return h.Cores == nil },
			func(h Host) bool { return h.MemTotalBytes != nil && h.Load1 != nil }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			g, _ := newFakeHostGauge(c.missing...)
			h, ok := g.Host(context.Background())
			if !ok {
				t.Fatal("one missing file must not suppress the whole reading")
			}
			if !c.absent(h) {
				t.Fatalf("the missing file must leave its field absent: %+v", h)
			}
			if !c.present(h) {
				t.Fatalf("the other fields must survive: %+v", h)
			}
		})
	}
}

func TestHostDropsDiskWhenStatfsFails(t *testing.T) {
	g, p := newFakeHostGauge()
	p.statfs = func(string) (uint64, uint64, error) { return 0, 0, errors.New("statfs: no such file") }
	h, ok := g.Host(context.Background())
	if !ok {
		t.Fatal("a failing statfs must not suppress the rest")
	}
	if h.DiskTotalBytes != nil || h.DiskUsedBytes != nil {
		t.Fatalf("disk must be absent rather than zero: %+v", h)
	}
	if h.MemTotalBytes == nil {
		t.Fatal("memory must survive a failing statfs")
	}
}

func TestHostSaysNothingWithoutProc(t *testing.T) {
	g := &procGauge{
		readFile:  func(string) ([]byte, error) { return nil, errors.New("no /proc") },
		diskUsage: func(string) (uint64, uint64, error) { return 0, 0, errors.New("no statfs") },
		warmup:    time.Millisecond,
	}
	if _, ok := g.Host(context.Background()); ok {
		t.Fatal("a host with nothing readable must answer nothing, never zeros")
	}
}

func TestHostDoesNotWaitForTheCPUDelta(t *testing.T) {
	// The very first read, with no previous sample stored: Sample would wait
	// out its warm-up, Host answers now and carries memory and disk.
	g, _ := newFakeHostGauge()
	g.warmup = time.Hour
	done := make(chan Host, 1)
	go func() {
		h, _ := g.Host(context.Background())
		done <- h
	}()
	select {
	case h := <-done:
		if h.MemTotalBytes == nil || h.DiskTotalBytes == nil {
			t.Fatalf("the first host read must already carry memory and disk: %+v", h)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Host must not wait for a CPU delta")
	}
	if g.prev != nil {
		t.Fatal("Host must not disturb the CPU series")
	}
}

func TestSampleCarriesTheAbsolutesToo(t *testing.T) {
	p := &fakeProc{}
	g := &procGauge{
		readFile: func(path string) ([]byte, error) {
			if path == "/proc/loadavg" {
				return []byte(loadAvgSample), nil
			}
			if path == "/proc/uptime" {
				return []byte(uptimeSample), nil
			}
			return p.read(path)
		},
		diskUsage: func(string) (uint64, uint64, error) { return 10, 4, nil },
		warmup:    time.Millisecond,
	}
	r, ok := g.Sample(context.Background())
	if !ok {
		t.Fatal("a readable /proc must yield a reading")
	}
	if r.Host.MemTotalBytes == nil || r.Host.DiskTotalBytes == nil {
		t.Fatalf("one Reading feeds two frames: %+v", r.Host)
	}
}

func TestStatfsUsageReadsARealPath(t *testing.T) {
	total, used, err := statfsUsage(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if total == 0 || used > total {
		t.Fatalf("statfsUsage = %d used of %d", used, total)
	}
}
