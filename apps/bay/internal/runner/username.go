package runner

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// maxUserNameLen is what useradd accepts on most systems.
//
// The limit is not systemd's, it is the utmp/passwd one, and it is why a
// name has to be squeezed at all.
const maxUserNameLen = 32

func unitName(key string) string {
	// "lore/production" -> "bay-lore-production"
	return "bay-" + strings.ReplaceAll(key, "/", "-")
}

// UserName returns the dedicated unix user for an app instance.
//
// The obvious squeeze - cut the unit name at 32 characters - makes the name
// a many-to-one function of the key. Two instances whose names differ only
// past the cut become the same Unix user, and that user owns both `.env`
// files and both databases: each app can read the other's secrets. The
// isolation the per-instance user exists to provide is exactly what the
// truncation removed, and silently, because nothing downstream can tell a
// shared user from a dedicated one.
//
// So a name that does not fit carries a hash of the WHOLE key instead of
// dropping the part that did not fit. The prefix is kept for the operator
// reading `ps` or `ls -l`; the suffix is what makes it injective in
// practice.
//
// A name that already fits is returned unchanged, deliberately. Every
// instance provisioned before this owns files as `bay-<app>-<env>`, and
// changing what `UserName` answers for them would orphan that ownership on
// the next deploy - the app would start as a user with no access to its own
// database. Only the names that were being truncated move, and those were
// the broken ones.
func UserName(key string) string {
	name := unitName(key)
	if len(name) <= maxUserNameLen {
		return name
	}
	// 32 bits of the key's digest. Not collision-proof on its own, which is
	// why `Deploy` also refuses a name another instance already holds -
	// astronomically unlikely is not the same as impossible, and the failure
	// mode here is two apps reading each other's secrets.
	sum := sha256.Sum256([]byte(key))
	suffix := hex.EncodeToString(sum[:4])
	// Everything the suffix does not claim, minus its separator.
	head := name[:maxUserNameLen-len(suffix)-1]
	// A truncated head can end on the separator the key's own "/" became,
	// which would leave a "--" in the middle. Cosmetic, but the name is
	// something an operator reads.
	head = strings.TrimRight(head, "-")
	return head + "-" + suffix
}
