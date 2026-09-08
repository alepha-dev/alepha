/*
Package naming composes the identifiers Bay writes to disk and to S3.

⚠️ ONE path segment, not two. An instance used to live at `apps/<name>/<env>/`
and its blobs at `apps/<name>/<env>/blobs`, which reads naturally and cannot
express what a deploy through Lore needs: two Lore projects that each call an
app `api` and deploy `production` onto one machine met at the same directory,
the same S3 prefix and the same backup keys — one app's uploads interleaved
with another's, one app's snapshot restoring over the other's.

Folding the pair into a single segment is what makes the caller able to widen
it. `alepha platform` passes `--name club` and gets `club-production`; Lore
passes `--name <project>-club` and gets `<project>-club-production`. Bay needs
no project field of its own, and cannot be handed a pair it would have to
reconcile.

⚠️ This is the STORAGE identity only. `state.App.Key()` stays `name/env` and is
what every command, route and log line still speaks — `bay logs club/production`
is unchanged. The two are deliberately different: one addresses a directory, the
other addresses an app in conversation with a person.
*/
package naming

import "strings"

// Instance is the single path segment holding one app instance's durable
// state, and the prefix under which its blobs and backups are stored.
//
// ⚠️ Not reversible, and nothing may try: `a-b` + `c` and `a` + `b-c` compose
// to the same segment. Every caller that needs the pair back has `state.App`,
// which carries both fields — the segment is an address, never a record.
func Instance(name, env string) string {
	return strings.Join([]string{name, env}, "-")
}
