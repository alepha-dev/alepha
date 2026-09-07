package main

import (
	"context"
	"time"

	"github.com/alepha/bay/internal/connector"
)

/*
Inventory is what this machine reports about itself, for the console.

The executor answers it because it already holds the server: `s.listApps()`
assembles the stored record, whether the runner considers the app up, and the
supervisor's usage when there is one, and every derived fact comes from
`computeStatus`, the same function `bay status --json` prints. There is no
second implementation of "is this backup stale" anywhere in this repository,
and that is the point.

The host block is left empty here. It comes from the gauge, which the client
owns, so the client fills it on its way out; this side knows about apps.
*/
func (a *actions) Inventory(context.Context) (connector.Inventory, bool) {
	now := time.Now()
	interval := a.s.backupInterval
	apps := a.s.listApps()
	rows := make([]connector.InventoryApp, 0, len(apps))
	for _, app := range apps {
		rows = append(rows, inventoryRow(app, a.s.runner.State(app.Key()), now, interval))
	}
	return connector.Inventory{
		Type: "inventory",
		At:   now.UTC().Format(time.RFC3339),
		Apps: rows,
	}, true
}

/*
inventoryRow is one instance on the wire: what `bay status` derives, plus the
raw fields it does not render.

⚠️ Nothing here rounds a duration into a string. `uptime`, `idleFor` and
`backupAge` are `bay status`'s rendering for a terminal; Lore renders its own
from the timestamps, in the viewer's locale, and a duration computed at push
time would be wrong on the page within a minute.

⚠️ Nil `Usage` leaves every field it feeds absent. An unsupervised child
process and an app that is not running both have none, and "0 restarts" from a
supervisor that measured nothing is a claim rather than a reading.
*/
func inventoryRow(a listedApp, state string, now time.Time, interval time.Duration) connector.InventoryApp {
	line := computeStatus(a, now, interval)
	row := connector.InventoryApp{
		App:     a.Name,
		Env:     a.Env,
		Runtime: a.Runtime,
		Release: a.Release,
		Port:    a.Port,
		Domains: a.Domains,

		Running: a.Running,
		State:   state,
		Stopped: a.Stopped,
		Static:  a.Static,

		Backups:         a.Backups,
		LastBackupAt:    a.LastBackupAt,
		BackupStale:     line.BackupStale,
		LastBackupError: a.LastBackupError,

		LastRequestAt: a.LastRequestAt,
		Crons:         a.Crons,

		Problems: line.Problems,
	}
	if u := a.Usage; u != nil {
		restarts, memory, cpu, tasks := u.Restarts, u.MemoryBytes, u.CPUSeconds, u.Tasks
		row.Restarts, row.MemoryBytes, row.CPUSeconds, row.Tasks = &restarts, &memory, &cpu, &tasks
		if !u.StartedAt.IsZero() {
			row.StartedAt = u.StartedAt.UTC().Format(time.RFC3339)
		}
	}
	return row
}
