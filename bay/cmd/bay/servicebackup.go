package main

import (
	"bytes"
	"context"

	"github.com/alepha-dev/bay/internal/stack"
	"github.com/alepha-dev/bay/internal/state"
)

/*
serviceDumper runs a stack service's `x-lore.backup` hook inside the service's
container.

The postgres form dumps in pg_dump's custom format, uncompressed so the one
compression is Bay's, and verifies with `pg_restore --list`, which reads the
whole table of contents and refuses a truncated file. A command hook's stdout
is the dump; Bay cannot read an arbitrary format, so it checks only that the
hook wrote something.
*/
type serviceDumper struct {
	container string
	hook      state.BackupHook
}

func (d serviceDumper) Dump(ctx context.Context) ([]byte, error) {
	if d.hook.PostgresDB != "" {
		return stack.Exec(ctx, d.container, nil, "pg_dump", "-U", d.hook.PostgresUser, "-d", d.hook.PostgresDB, "--format=custom", "-Z0")
	}
	return stack.Exec(ctx, d.container, nil, "sh", "-c", d.hook.Command)
}

func (d serviceDumper) Verify(ctx context.Context, dump []byte) error {
	if d.hook.PostgresDB == "" {
		return nil
	}
	_, err := stack.Exec(ctx, d.container, bytes.NewReader(dump), "pg_restore", "--list")
	return err
}

/*
serviceNotBackedUp says what a service dump leaves out: a hook dumps the
database, never the files beside it in the service's volumes.
*/
func serviceNotBackedUp(app state.App) []string {
	return []string{"files in the volumes of " + app.Service + " (the hook dumps its database, not its disk)"}
}
