package main

import (
	"context"
	"path/filepath"

	"github.com/alepha-dev/bay/internal/backup"
	"github.com/alepha-dev/bay/internal/deploy"
	"github.com/alepha-dev/bay/internal/naming"
	"github.com/alepha-dev/bay/internal/s3"
	"github.com/alepha-dev/bay/internal/state"
)

/*
appSecretChecks is one line per instance on its APP_SECRET: is the key it runs
on the one its latest backup carries, and did Lore hold the same key at the
last deploy.

Equal or different, never the hash. The Lore half is a record, not a live
check: Lore answers its hash only inside a deploy command, so each deploy
stores what it found and this reads it.

A key other than the latest snapshot's is a warning: the snapshot's data was
sealed with another key, so restoring it brings back MFA rows and links that
will not open under the current one.
*/
func appSecretChecks(ctx context.Context, root string, st *state.State) []check {
	var mgr *backup.Manager
	if st.S3 != nil {
		t := st.S3.S3Target
		if client, err := s3.New(s3.Config{Endpoint: t.Endpoint, Bucket: t.Bucket,
			AccessKey: t.AccessKey, SecretKey: t.SecretKey, Region: t.Region}); err == nil {
			mgr = backup.New(client)
		}
	}
	var checks []check
	for _, a := range st.Apps {
		if a.Static || a.Image != "" || a.BackupHook != nil {
			continue
		}
		key, err := deploy.ReadAppSecret(filepath.Join(root, "apps", naming.Instance(a.Name, a.Env)))
		c := check{Name: "key " + a.Key(), OK: true}
		switch {
		case err != nil:
			c.OK, c.Detail = false, "cannot read its .env: "+err.Error()
			checks = append(checks, c)
			continue
		case key == "":
			c.OK, c.Warn, c.Detail = false, true, "no APP_SECRET in its .env: the next deploy mints one"
			checks = append(checks, c)
			continue
		}
		c.Detail = snapshotSecretNote(ctx, mgr, a, key, &c) + "; " + loreSecretNote(a)
		checks = append(checks, c)
	}
	return checks
}

func snapshotSecretNote(ctx context.Context, mgr *backup.Manager, a state.App, key string, c *check) string {
	if !a.Backups {
		return "not backed up by Bay, so no snapshot carries its key"
	}
	if mgr == nil {
		return "no backups configured, so no snapshot carries its key"
	}
	probe, cancel := context.WithTimeout(ctx, storageProbeTimeout)
	defer cancel()
	latest, found, err := mgr.Latest(probe, a.Name, a.Env)
	switch {
	case err != nil:
		return "latest snapshot not read: " + err.Error()
	case !found:
		return "no snapshot yet"
	case latest.Kind != backup.KindBundle:
		return "the latest snapshot predates bundles and carries no key"
	}
	man, err := mgr.Manifest(probe, latest.Key)
	switch {
	case err != nil:
		return "latest snapshot not read: " + err.Error()
	case man.AppSecretSHA256 == "":
		c.OK, c.Warn = false, true
		return "the latest snapshot carries no key (taken before backups carried it): back it up again"
	case man.AppSecretSHA256 != backup.AppSecretSHA256(key):
		c.OK, c.Warn = false, true
		return "the latest snapshot holds ANOTHER key: its data was sealed with it, and restoring it needs `bay restore " +
			a.Key() + " --with-key`"
	}
	return "the latest snapshot carries the same key"
}

func loreSecretNote(a state.App) string {
	st := a.AppSecret
	if st == nil || st.Lore == "" {
		return "Lore: not recorded (no deploy from Lore since Bay recorded it)"
	}
	switch st.Lore {
	case state.LoreSecretMatch:
		return "Lore held the same key at the last deploy (" + st.LoreAt + ")"
	case state.LoreSecretSent:
		return "Lore was sent this key at the last deploy (" + st.LoreAt + ")"
	}
	return "Lore: unknown at the last deploy (" + st.LoreAt + ")"
}
