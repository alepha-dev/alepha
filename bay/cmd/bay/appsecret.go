package main

import (
	"fmt"
	"time"

	"github.com/alepha-dev/bay/internal/backup"
	"github.com/alepha-dev/bay/internal/deploy"
	"github.com/alepha-dev/bay/internal/state"
)

/*
What a restore does with the APP_SECRET a backup carries.

A bundle holds the key its data was sealed with (MFA secrets, signed links).
The rules, from the epic that made bundles carry it:

  - the key comes back only with its databases, and only into the instance
    the bundle was taken from: another instance's key never crosses;
  - an instance that already had a key keeps it, except when that key is
    worth nothing yet: minted (or taken from Lore) by the deploy now running,
    or minted while the instance ran empty under RestorePending, which the
    restore that clears the hold replaces;
  - and except `bay restore --with-key`, the operator's deliberate choice.

Answers, logs, events and records say only what happened to the key, never
the key, nor its hash.
*/

// The outcomes of a restore for the key, as answers and records say them.
const (
	secretRestored = "restored"     // the backup's key is now the instance's
	secretKept     = "kept"         // the instance kept its own key
	secretAbsent   = "absent"       // the backup carries no key
	secretMissing  = "missing"      // the manifest names a key the bucket no longer holds
	secretNotMoved = "not-restored" // a backup of another instance: its key never crosses
)

// secretPlan is what a restore will do with the key, decided before the app
// is stopped so a refusal costs nothing.
type secretPlan struct {
	replace bool
	key     string
	outcome string
	// note is said in the answer; warning is the louder kind, which
	// `alepha deploy` and Lore show.
	note, warning string
}

type secretInput struct {
	app state.App
	// sameInstance: the backup was taken from the instance it is restored into.
	sameInstance bool
	// current is the instance's key now, "" when it has none.
	current string
	// fresh: the deploy now running gave the instance its key.
	fresh bool
	// pending: the instance ran empty, under RestorePending, until now.
	pending bool
	withKey bool
}

func planSecretRestore(f *backup.Fetched, in secretInput) secretPlan {
	key := in.app.Key()
	switch f.AppSecretStatus() {
	case backup.SecretAbsent:
		return secretPlan{outcome: secretAbsent,
			note: "the backup carries no APP_SECRET (taken before backups carried it): " + key + " keeps its current key"}
	case backup.SecretMissing:
		return secretPlan{outcome: secretMissing,
			note: "the backup's APP_SECRET object is missing from the bucket: " + key + " keeps its current key"}
	}
	if !in.sameInstance {
		return secretPlan{outcome: secretNotMoved,
			note: "a backup of another instance never brings its APP_SECRET: " + key + " keeps its own key"}
	}
	snapshot := f.AppSecret()
	switch {
	case in.current == "" || in.fresh:
		return secretPlan{replace: true, key: snapshot, outcome: secretRestored,
			note: "APP_SECRET restored from the backup, with the data it sealed"}
	case in.withKey:
		return secretPlan{replace: true, key: snapshot, outcome: secretRestored,
			note: "APP_SECRET restored from the backup (--with-key): every session signed before is signed out"}
	case in.pending:
		return secretPlan{replace: true, key: snapshot, outcome: secretRestored,
			note: "APP_SECRET restored from the backup: " + key + " ran empty on a key of its own until now, " +
				"so every session signed since it started empty is signed out"}
	}
	plan := secretPlan{outcome: secretKept}
	if backup.AppSecretSHA256(in.current) != backup.AppSecretSHA256(snapshot) {
		plan.warning = fmt.Sprintf(
			"%[1]s keeps its current APP_SECRET, which is not the one this backup's data was sealed with: "+
				"MFA enrolled under the backup's key will not open, and links it signed will not verify. "+
				"`bay restore %[1]s --key <this backup> --with-key` restores the backup's key with its data, "+
				"and signs every current session out", key)
	}
	return plan
}

// applySecretPlan writes the backup's key when the plan says so. The caller
// has stopped the app, and starts it afterwards on the key now in `.env`.
func (s *server) applySecretPlan(app state.App, plan secretPlan) secretPlan {
	if !plan.replace {
		return plan
	}
	if err := deploy.InstallAppSecret(s.instanceDir(app), plan.key); err != nil {
		s.log.Error("could not restore the backup's APP_SECRET", "app", app.Key(), "err", err)
		plan.replace, plan.outcome = false, secretKept
		plan.warning = app.Key() + " could not take the backup's APP_SECRET (" + err.Error() +
			"): it keeps its current key, which its restored data was not sealed with"
		plan.note = ""
	}
	return plan
}

// say puts the plan's outcome into a restore's answer.
func (p secretPlan) say(resp map[string]any) {
	resp["appSecret"] = p.outcome
	if p.note != "" {
		resp["appSecretNote"] = p.note
	}
	if p.warning != "" {
		resp["warning"] = joinWarnings(resp["warning"], p.warning)
	}
}

/*
recordSecretSource records on the instance where its key came from in this
deploy, and answers it: the source provision reported, or `snapshot` when
the auto-restore put the backup's key back.

A key minted over data the auto-restore just brought back is a warning, not
a log line: the 2026-11-10 recovery test reported "data identical" while
every MFA user was locked out, because nothing said the key was new. It goes
into the restore's warning, which `alepha deploy` prints and Lore shows, and
stays on the instance, which `bay status` flags, until the next deploy.
*/
func (s *server) recordSecretSource(res *deploy.Result, restore map[string]any) string {
	if res.SecretSource == "" {
		return ""
	}
	source := res.SecretSource
	if restore["appSecret"] == secretRestored {
		source = state.SecretSnapshot
	}
	warning := ""
	if _, restored := restore["restoredAt"]; restored && source == state.SecretMinted {
		warning = mintedOverRestoreWarning(res.App.Key())
		restore["warning"] = joinWarnings(restore["warning"], warning)
		s.log.Warn("the instance runs on a NEW APP_SECRET over restored data", "app", res.App.Key())
		s.emit("appsecret.minted", &res.App, map[string]any{"overRestoredData": true})
	}
	if err := s.store.SetAppSecretSource(res.App.Key(), source, "deploy", warning, time.Now()); err != nil {
		s.log.Error("could not record where the APP_SECRET came from", "app", res.App.Key(), "err", err)
	}
	s.log.Info("APP_SECRET", "app", res.App.Key(), "source", source)
	return source
}

/*
recordRestoredSecret records what a restore did to the key: `snapshot` when
it put the backup's key back. A late restore (the one that clears
RestorePending) that brings data back from a backup carrying no key leaves
the instance on the key minted while it ran empty, which is the same warning
a deploy gives, said in the plan and kept on the instance.
*/
func (s *server) recordRestoredSecret(app state.App, plan *secretPlan, sameInstance, pending bool) {
	now := time.Now()
	if plan.outcome == secretRestored {
		if err := s.store.SetAppSecretSource(app.Key(), state.SecretSnapshot, "restore", "", now); err != nil {
			s.log.Error("could not record where the APP_SECRET came from", "app", app.Key(), "err", err)
		}
		return
	}
	minted := app.AppSecret != nil && app.AppSecret.Source == state.SecretMinted
	if !sameInstance || !pending || !minted || (plan.outcome != secretAbsent && plan.outcome != secretMissing) {
		return
	}
	warning := mintedOverRestoreWarning(app.Key())
	plan.warning = joinWarnings(plan.warning, warning)
	s.log.Warn("the instance runs on a NEW APP_SECRET over restored data", "app", app.Key())
	if err := s.store.SetAppSecretSource(app.Key(), state.SecretMinted, "restore", warning, now); err != nil {
		s.log.Error("could not record the APP_SECRET warning", "app", app.Key(), "err", err)
	}
}

func mintedOverRestoreWarning(key string) string {
	return fmt.Sprintf(
		"%[1]s runs on a NEW APP_SECRET over data restored from a backup that carried none: "+
			"MFA enrolled before will not open and links signed before will not verify. "+
			"If the previous key is kept somewhere, `bay secret replace %[1]s APP_SECRET -` puts it back", key)
}

func joinWarnings(existing any, more string) string {
	if s, _ := existing.(string); s != "" {
		return s + "\n" + more
	}
	return more
}
