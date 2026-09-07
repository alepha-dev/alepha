//go:build !linux

package connector

import "context"

// noGauge is the portable fallback: it reports nothing, never zeros. Bay is
// developed on macOS and runs on Linux, and a laptop that pushed "CPU 0%" to
// an estate list would be reporting a fact it does not have.
type noGauge struct{}

// HostGauge has nothing to read off Linux. The root is taken and ignored, so
// the caller reads the same on every platform.
func HostGauge(string) Gauge { return noGauge{} }

func (noGauge) Sample(context.Context) (Reading, bool) { return Reading{}, false }

// Host says nothing off Linux for the same reason: an absent memory total is
// a console that says "not reported", a zero one is a console that says the
// machine has no memory.
func (noGauge) Host(context.Context) (Host, bool) { return Host{}, false }
