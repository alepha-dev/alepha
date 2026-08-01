package main

import (
	"errors"
	"strconv"
)

/*
parseKeepReleases reads the --keep-releases value.

Its own function because it is the one flag whose value DELETES things, and the
difference between refusing a bad value and falling back to a default is the
difference between an operator seeing their typo and an operator believing a
retention policy they never set. Same refusal as --backup-interval, for the
same reason, with more at stake.

Floored at two, not one. Automatic rollback swaps `current` back to the release
that was serving a moment ago, so keeping only the newest would delete the very
target `watchAndRollback` reaches for — and the safety net would fail silently,
at the one moment it is load bearing. Rollback needs somewhere to go.

`strconv.Atoi` rather than anything more forgiving: it rejects "5.9" and
"5releases" outright, where a lenient parse would silently keep a number the
operator never typed.
*/
func parseKeepReleases(value string) (int, error) {
	n, err := strconv.Atoi(value)
	if err != nil || n < 2 {
		return 0, errors.New("must be a whole number of at least 2")
	}
	return n, nil
}
