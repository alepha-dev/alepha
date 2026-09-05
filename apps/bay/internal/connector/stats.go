package connector

import (
	"context"
	"time"
)

const (
	// DefaultStatsIntervalSeconds is what a welcome that names no interval
	// gets: Lore's own default for a new estate.
	DefaultStatsIntervalSeconds = 1800
	// DefaultMinStatsInterval is the floor under whatever Lore names, the
	// same floor Lore's schema enforces; a test lowers it to run in
	// milliseconds.
	DefaultMinStatsInterval = time.Minute
)

/*
statsLoop pushes the host gauge on the interval the welcome frame names, for
the life of one session.

Its own clock, deliberately independent of commands: those push the instant
Lore queues them, and this one runs at whatever cadence reads well on the
estate list, thirty minutes by default. One push goes out right after the
welcome, so a freshly enrolled machine shows a figure within seconds instead
of half an hour later, and every config frame re-arms the interval.

There is no wire flag for the series switch. Bay pushes the gauge always;
whether a reading also lands in Lore's series is `collectSeries` on the row,
and Bay never hears about it.
*/
func (c *Client) statsLoop(ctx context.Context) {
	if c.Gauge == nil {
		return
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.statsKick:
			// A welcome or config just landed: push now, then re-arm below
			// at whatever interval it named.
			c.pushStats(ctx)
		case <-time.After(c.statsInterval()):
			c.pushStats(ctx)
		}
	}
}

func (c *Client) pushStats(ctx context.Context) {
	reading, ok := c.Gauge.Sample(ctx)
	if !ok {
		return
	}
	cpu, okCPU := sanitizePercent(reading.CPUPercent)
	mem, okMem := sanitizePercent(reading.MemoryPercent)
	if !okCPU || !okMem {
		c.Log.Debug("host gauge produced a non-number, not sent")
		return
	}
	frame := Stats{
		Type:          "stats",
		CPUPercent:    cpu,
		MemoryPercent: mem,
		At:            c.Now().UTC().Format(time.RFC3339),
	}
	if err := c.Send(frame); err != nil {
		c.Log.Debug("stats not sent", "err", err)
	}
}

// statsInterval is the interval in force, never under the floor.
func (c *Client) statsInterval() time.Duration {
	seconds := c.statsSeconds.Load()
	if seconds <= 0 {
		seconds = DefaultStatsIntervalSeconds
	}
	return max(time.Duration(seconds)*time.Second, c.MinStatsInterval)
}

// kickStats asks the loop for a push now. Non-blocking: a kick while one is
// pending is the same request twice.
func (c *Client) kickStats() {
	select {
	case c.statsKick <- struct{}{}:
	default:
	}
}
