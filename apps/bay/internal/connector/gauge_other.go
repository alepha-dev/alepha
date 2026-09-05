//go:build !linux

package connector

import "context"

// noGauge is the portable fallback: it reports nothing, never zeros. Bay is
// developed on macOS and runs on Linux, and a laptop that pushed "CPU 0%" to
// an estate list would be reporting a fact it does not have.
type noGauge struct{}

// HostGauge has nothing to read off Linux.
func HostGauge() Gauge { return noGauge{} }

func (noGauge) Sample(context.Context) (Reading, bool) { return Reading{}, false }
