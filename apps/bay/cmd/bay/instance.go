package main

import (
	"errors"
	"strings"
	"time"
)

// booleanFlags are the flags that take no value.
//
// An allowlist of these rather than a denylist of the value-taking ones, which
// is what the first version got wrong: it listed the flags the command itself
// declared and therefore read the argument after --control-socket as the
// instance. That flag is handled globally, before any command sees it, so
// nothing local mentioned it — and `bay logs lore/production --control-socket
// /run/bay/control.sock` parsed "/run/bay/control.sock" as an app name with an
// empty first segment.
//
// Framed this way the mistake fails safe: an unknown flag's value is skipped
// rather than mistaken for a positional.
var booleanFlags = map[string]bool{"--json": true}

// instanceFromArgs accepts `bay logs lore/production` as well as the
// --name/--env pair every other command takes.
func instanceFromArgs(args []string) (string, string, error) {
	name, env := "", "production"
	for i, arg := range args {
		if i < len(args)-1 {
			switch arg {
			case "--name":
				name = args[i+1]
				continue
			case "--env":
				env = args[i+1]
				continue
			}
		}
		if strings.HasPrefix(arg, "-") {
			continue
		}
		// A bare word directly after a value-taking flag is that flag's value,
		// not the instance.
		if i > 0 && strings.HasPrefix(args[i-1], "-") && !booleanFlags[args[i-1]] {
			continue
		}
		if instance, suffix, found := strings.Cut(arg, "/"); found {
			name, env = instance, suffix
		} else if name == "" {
			name = arg
		}
	}
	if name == "" {
		return "", "", errors.New("no instance given")
	}
	return name, env, nil
}

// uptimeOf renders how long the current run has lasted.
//
// Empty rather than "0s" when the supervisor did not report a start time: "up
// 0s" reads as an app that just restarted, which is a much louder claim than
// "I do not know".
func uptimeOf(startedAt time.Time) string {
	if startedAt.IsZero() {
		return ""
	}
	return time.Since(startedAt).Round(time.Second).String()
}
