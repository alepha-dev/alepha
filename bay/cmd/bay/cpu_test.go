package main

import "testing"

// The policy in one sentence: no single app may take more than half the
// machine, so the other apps and Bay's own proxy always have the other half.
func TestCPUPercentForLeavesHalfTheMachine(t *testing.T) {
	cases := []struct {
		name  string
		cores int
		want  int
	}{
		// The VPS Bay actually runs on. One core for the busiest app, one for
		// everything else.
		{"two cores", 2, 100},
		{"four cores", 4, 200},
		{"eight cores", 8, 400},
		// Half a core would make a cold start twice as slow on the machine
		// least able to afford it, and there is no protection to buy anyway:
		// with one core, every ceiling is either the whole machine or a
		// handicap. The floor says so out loud.
		{"one core cannot be divided", 1, 100},
		// runtime.NumCPU never returns zero, but a zero reaching this must not
		// render a zero ceiling — that grants no CPU at all and the app never boots.
		{"zero is not a starvation order", 0, 100},
		{"negative is not a starvation order", -4, 100},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := cpuPercentFor(tc.cores); got != tc.want {
				t.Fatalf("cpuPercentFor(%d) = %d, want %d", tc.cores, got, tc.want)
			}
		})
	}
}
