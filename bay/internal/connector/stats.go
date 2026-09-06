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
	// DefaultMinInventoryInterval is the floor between two inventory pushes.
	// Short enough that a restart is visible on the console straight away,
	// long enough that a burst of finished commands cannot make this machine
	// run a `systemctl show` per instance over and over.
	DefaultMinInventoryInterval = 5 * time.Second
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
	if c.Gauge == nil && c.Handler == nil {
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
		case <-c.inventoryKick:
			// A command finished, or Lore asked. No series sample: that is
			// the whole reason this is a channel of its own.
			c.pushInventory(ctx)
		case <-time.After(c.statsInterval()):
			c.pushStats(ctx)
			c.pushInventory(ctx)
		}
	}
}

/*
pushInventory assembles what the machine has to say about its apps, stamps the
host reading and the version on it, and sends it.

The two halves come from two places on purpose: the executor holds the server
and answers for the apps, the gauge reads the host and is the client's. Neither
knows about the other, and this is where they meet.

A send that fails is a debug line. The connection drops all the time, Lore
re-reads the whole picture on the next connect, and a push that could not go
out must never fail the command that triggered it.
*/
func (c *Client) pushInventory(ctx context.Context) {
	if c.Handler == nil {
		return
	}
	if !c.awaitInventoryFloor(ctx) {
		return
	}
	inv, ok := c.Handler.Inventory(ctx)
	if !ok {
		// Nothing to say. A frame of zeros would read as a host that lost
		// every app it was running.
		return
	}
	inv.Type = "inventory"
	if inv.At == "" {
		inv.At = c.Now().UTC().Format(time.RFC3339)
	}
	if c.Gauge != nil {
		if host, ok := c.Gauge.Host(ctx); ok {
			inv.Host = host
		}
	}
	// Stamped here rather than read by the gauge: `version` is a package main
	// variable and internal/connector cannot import main.
	inv.Host.BayVersion = c.Version
	if err := c.Send(inv); err != nil {
		c.Log.Debug("inventory not sent", "err", err)
	}
}

/*
awaitInventoryFloor holds until the floor has passed since the last push.

It waits rather than drops. A dropped push loses the state change that asked
for it until the next tick, which is up to half an hour of a console showing
an app the operator just restarted as it was before; waiting costs at most the
floor and loses nothing. Kicks are buffered one deep, so a burst collapses into
one more push rather than a queue of them.

False means the session ended while waiting, and nothing should be sent.
*/
func (c *Client) awaitInventoryFloor(ctx context.Context) bool {
	c.inventoryMu.Lock()
	wait := c.MinInventoryInterval - c.Now().Sub(c.lastInventory)
	c.inventoryMu.Unlock()
	if wait > 0 {
		select {
		case <-ctx.Done():
			return false
		case <-time.After(wait):
		}
	}
	c.inventoryMu.Lock()
	c.lastInventory = c.Now()
	c.inventoryMu.Unlock()
	return true
}

func (c *Client) pushStats(ctx context.Context) {
	// The loop now runs for the inventory too, so a Bay with an executor and
	// no gauge reaches here. Nothing to sample is nothing to send.
	if c.Gauge == nil {
		return
	}
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
	c.ensureChannels()
	select {
	case c.statsKick <- struct{}{}:
	default:
	}
}

/*
KickInventory asks the loop for an inventory push now, and for nothing else.

Exported because the two callers are outside this package: the executor calls
it after a command finishes, and Lore's `query` frame lands on it. Both want
the app list refreshed and neither wants a series sample, which is exactly the
distinction the separate channel exists for.

Non-blocking, and never an error. A kick while one is pending is the same
request twice, which is the coalescing a burst of finished commands needs.
*/
func (c *Client) KickInventory() {
	c.ensureChannels()
	select {
	case c.inventoryKick <- struct{}{}:
	default:
	}
}
