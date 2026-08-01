package main

import "fmt"

/*
cpuQuotaFor returns the per-app CPU ceiling for a host with `cores` CPUs.

The policy is one sentence: **no single app may take more than half the
machine.** Whatever else is happening, the other apps and — the part that
matters — Bay's own proxy always have the other half. A prototype in a tight
loop then costs its own latency instead of the whole host's, which is the
difference between one broken app and a site-wide outage.

Derived from the core count rather than hardcoded because the machine is
expected to grow. A fixed "100%" is half of a two-core VPS and a quarter of a
four-core one, so the protection would silently tighten every time the host is
upgraded — exactly when the operator expects the opposite.

The floor of 100% is not a rounding convenience. On a single-core host every
possible ceiling is either the whole machine or a handicap, so there is no
protection to buy; taking the handicap would double cold-start times on the
machine least able to afford it. It also keeps a zero or negative core count
— which `runtime.NumCPU` never returns, but a caller might — from rendering
`CPUQuota=0%`, which grants no CPU at all and leaves an app that never boots.
*/
func cpuQuotaFor(cores int) string {
	percent := cores * 50
	if percent < 100 {
		percent = 100
	}
	return fmt.Sprintf("%d%%", percent)
}
