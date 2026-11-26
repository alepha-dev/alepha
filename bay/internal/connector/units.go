package connector

import (
	"bufio"
	"context"
	"errors"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

/*
Units are the systemd units Lore asked this machine to watch (`watchUnits` on
the welcome and config frames): the services an operator cares about on a host
Bay does not run, such as an API behind a reverse proxy.

Bay reads them, it never touches them. `systemctl show` answers any user, so a
monitor-only `bay agent` running as a plain account watches system units as
well as root would.

Two things leave the machine. The inventory's host block carries every watched
unit's state as it is now (`host.units`), and every change of state is an event
(`unit.changed`), spooled like a failed backup: a crash at 3am while the
connection was down still reaches Lore, in order, when it comes back. A deploy
that restarts the API is, from here, the unit going `deactivating`, `inactive`,
`activating` and `active`, which is how Lore draws it on a timeline without a
hook in anybody's release script.
*/

// UnitState is one watched unit, as Bay last read it.
type UnitState struct {
	Name string `json:"name"`
	// ActiveState is systemd's: active, activating, deactivating, inactive,
	// failed, reloading. `not-found` when the machine has no such unit.
	ActiveState string `json:"activeState"`
	SubState    string `json:"subState,omitempty"`
	// Since is when the unit entered its current state (RFC 3339), absent
	// when systemd does not say.
	Since string `json:"since,omitempty"`
}

// UnitReader reads the state of the named units, in the order asked.
type UnitReader func(ctx context.Context, units []string) ([]UnitState, error)

const (
	// DefaultUnitPollInterval is how often the watched units are read. A
	// `systemctl show` costs next to nothing, and a failure seen fifteen
	// seconds late is soon enough for a page that refreshes on its own.
	DefaultUnitPollInterval = 15 * time.Second
	// MaxWatchedUnits bounds the list a welcome may name, the same bound
	// Lore's schema enforces.
	MaxWatchedUnits = 20
	// UnitChangedEvent is the kind of the event a change of state spools.
	UnitChangedEvent = "unit.changed"
)

var unitNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9@._:\\-]{0,199}$`)

/*
WatchableUnits keeps the names Bay agrees to read: systemd unit names only,
never a flag, at most MaxWatchedUnits, duplicates once. A name without a
suffix is a service, as `systemctl` itself reads it.
*/
func WatchableUnits(names []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, name := range names {
		name = strings.TrimSpace(name)
		if !unitNamePattern.MatchString(name) {
			continue
		}
		if !strings.Contains(name, ".") {
			name += ".service"
		}
		if seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
		if len(out) == MaxWatchedUnits {
			break
		}
	}
	return out
}

/*
SystemctlUnits reads units through `systemctl show`, one call for all of them.

`--timestamp=unix` makes the state-change time a number rather than a date in
the machine's locale and time zone, which no parser reads reliably.
*/
func SystemctlUnits(ctx context.Context, units []string) ([]UnitState, error) {
	if len(units) == 0 {
		return nil, nil
	}
	if _, err := exec.LookPath("systemctl"); err != nil {
		return nil, errors.New("systemctl is not on PATH")
	}
	args := []string{"show", "--no-pager", "--timestamp=unix",
		"--property=Id,LoadState,ActiveState,SubState,StateChangeTimestamp", "--"}
	out, err := exec.CommandContext(ctx, "systemctl", append(args, units...)...).Output()
	if err != nil {
		return nil, err
	}
	return parseSystemctlShow(string(out), units), nil
}

/*
parseSystemctlShow reads the blocks `systemctl show` prints, one per unit in
the order asked, separated by a blank line. The name asked for wins over `Id`:
an alias answers with the unit's own name, and the console should show what
the operator typed.
*/
func parseSystemctlShow(raw string, asked []string) []UnitState {
	blocks := [][]string{{}}
	scanner := bufio.NewScanner(strings.NewReader(raw))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" {
			if len(blocks[len(blocks)-1]) > 0 {
				blocks = append(blocks, []string{})
			}
			continue
		}
		blocks[len(blocks)-1] = append(blocks[len(blocks)-1], line)
	}
	out := []UnitState{}
	for i, block := range blocks {
		if len(block) == 0 || i >= len(asked) {
			continue
		}
		props := map[string]string{}
		for _, line := range block {
			key, value, ok := strings.Cut(line, "=")
			if ok {
				props[key] = value
			}
		}
		state := UnitState{Name: asked[i], ActiveState: props["ActiveState"], SubState: props["SubState"]}
		if props["LoadState"] == "not-found" {
			state.ActiveState, state.SubState = "not-found", ""
		}
		if ts := strings.TrimPrefix(props["StateChangeTimestamp"], "@"); ts != "" {
			if secs, err := strconv.ParseInt(ts, 10, 64); err == nil && secs > 0 {
				state.Since = time.Unix(secs, 0).UTC().Format(time.RFC3339)
			}
		}
		if state.ActiveState == "" {
			continue
		}
		out = append(out, state)
	}
	return out
}

// SetWatchedUnits replaces the list the units loop reads, and asks it to read
// now: a unit just added should show on the console in seconds.
func (c *Client) SetWatchedUnits(names []string) {
	list := WatchableUnits(names)
	c.unitsMu.Lock()
	changed := strings.Join(list, ",") != strings.Join(c.watchedUnits, ",")
	c.watchedUnits = list
	c.unitsMu.Unlock()
	if changed {
		c.ensureChannels()
		select {
		case c.unitsKick <- struct{}{}:
		default:
		}
	}
}

// unitStates is a copy of what the loop last read, for the inventory.
func (c *Client) unitStates() []UnitState {
	c.unitsMu.Lock()
	defer c.unitsMu.Unlock()
	if len(c.units) == 0 {
		return nil
	}
	return append([]UnitState(nil), c.units...)
}

/*
unitsLoop reads the watched units for the life of the process, connected or
not: a change while Lore is unreachable is spooled as an event and arrives
when the connection does.
*/
func (c *Client) unitsLoop(ctx context.Context) {
	if c.Units == nil {
		return
	}
	c.ensureChannels()
	every := c.UnitPollInterval
	if every <= 0 {
		every = DefaultUnitPollInterval
	}
	tick := time.NewTicker(every)
	defer tick.Stop()
	for {
		c.pollUnits(ctx)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		case <-c.unitsKick:
		}
	}
}

/*
pollUnits reads once, spools an event per unit whose state moved, and asks for
an inventory when anything did. The first reading of a unit is no event: Bay
did not see it change, it only started looking.
*/
func (c *Client) pollUnits(ctx context.Context) {
	c.unitsMu.Lock()
	watched := append([]string(nil), c.watchedUnits...)
	c.unitsMu.Unlock()

	var read []UnitState
	if len(watched) > 0 {
		var err error
		read, err = c.Units(ctx, watched)
		if err != nil {
			c.Log.Debug("watched units not read", "err", err)
			return
		}
	}

	c.unitsMu.Lock()
	previous := map[string]UnitState{}
	for _, u := range c.units {
		previous[u.Name] = u
	}
	changed := len(read) != len(c.units)
	moved := []UnitState{}
	for _, u := range read {
		before, known := previous[u.Name]
		if !known {
			changed = true
			continue
		}
		if before.ActiveState != u.ActiveState || before.SubState != u.SubState {
			changed = true
			moved = append(moved, u)
		} else if before.Since != u.Since {
			changed = true
		}
	}
	c.units = read
	c.unitsMu.Unlock()

	for _, u := range moved {
		before := previous[u.Name]
		data := map[string]any{
			"unit": u.Name,
			"from": before.ActiveState,
			"to":   u.ActiveState,
		}
		if before.SubState != "" {
			data["fromSub"] = before.SubState
		}
		if u.SubState != "" {
			data["toSub"] = u.SubState
		}
		if u.Since != "" {
			data["since"] = u.Since
		}
		if c.Events != nil {
			if _, err := c.Events.Append(UnitChangedEvent, "", "", data); err != nil {
				c.Log.Warn("unit change not spooled", "unit", u.Name, "err", err)
			}
		}
		c.Log.Info("watched unit changed", "unit", u.Name, "from", before.ActiveState, "to", u.ActiveState)
	}
	if changed {
		c.KickInventory()
	}
}
