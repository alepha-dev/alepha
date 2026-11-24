package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os/user"
	"regexp"
	"strings"
	"time"
)

/*
Sign-ins (#Q4256): whether the jobs user's tools are signed in, read with each
tool's own status command, as the jobs user, with no model call.

  - claude: `claude auth status --json`, its `loggedIn` (or an auth method
    other than none: an API key set up for the jobs user counts);
  - gh: `gh auth status --hostname github.com`, its exit status, and the
    account it names;
  - cf: `cf auth whoami`, its JSON `authenticated` and `email`;
  - lore: `lore project list`, which exits 3 when not authenticated;
  - gemini has no status command, and git no sign-in: unknown, and the
    capability check stays the proof that an agent CLI answers.

A status that cannot be read (no JSON where JSON was expected, a network
error) is unknown, never signed out: only a tool that says it is signed out
fails a job.

`lore` is the one tool that must NOT be signed in: a job's key reaches Lore's
MCP pinned to its project and its quest, and a CLI signed in on the jobs user
would give every job that account's whole rights. It is shown as a warning,
never required.
*/

// signInOf answers whether a tool is signed in (nil when unknown or not
// applicable) and the account when it says one.
func (r *processRunner) signInOf(ctx context.Context, u *user.User, name string) (*bool, string) {
	yes, no := true, false
	switch name {
	case "claude":
		stdout, _, code, err := r.toolRun(ctx, u, "claude", []string{"auth", "status", "--json"}, agentAdapters["claude"].Env)
		if err != nil || code != 0 {
			return nil, ""
		}
		var status map[string]any
		if json.Unmarshal([]byte(strings.TrimSpace(stdout)), &status) != nil {
			return nil, ""
		}
		logged, ok := status["loggedIn"].(bool)
		if !ok {
			return nil, ""
		}
		account, _ := status["email"].(string)
		if method, _ := status["authMethod"].(string); logged || (method != "" && method != "none") {
			return &yes, account
		}
		return &no, ""
	case "gh":
		stdout, stderr, code, err := r.toolRun(ctx, u, "gh", []string{"auth", "status", "--hostname", "github.com"}, nil)
		if err != nil {
			return nil, ""
		}
		if code != 0 {
			return &no, ""
		}
		if m := ghAccountPattern.FindStringSubmatch(stdout + "\n" + stderr); m != nil {
			return &yes, m[1]
		}
		return &yes, ""
	case "cf":
		stdout, _, _, err := r.toolRun(ctx, u, "cf", []string{"auth", "whoami"}, nil)
		if err != nil {
			return nil, ""
		}
		var whoami struct {
			Authenticated *bool  `json:"authenticated"`
			Email         string `json:"email"`
		}
		if json.Unmarshal([]byte(strings.TrimSpace(stdout)), &whoami) != nil || whoami.Authenticated == nil {
			return nil, ""
		}
		if *whoami.Authenticated {
			return &yes, whoami.Email
		}
		return &no, ""
	case "lore":
		_, _, code, err := r.toolRun(ctx, u, "lore", []string{"project", "list", "--output", "json"}, nil)
		switch {
		case err != nil:
			return nil, ""
		case code == 0:
			return &yes, ""
		case code == 3:
			return &no, ""
		}
		return nil, ""
	}
	return nil, ""
}

// ghAccountPattern finds the account `gh auth status` names.
var ghAccountPattern = regexp.MustCompile(`account (\S+)`)

// signInCommand is how the host's operator signs a tool in, as the jobs user.
func signInCommand(name, username string) string {
	switch name {
	case "claude":
		return "sudo -iu " + username + " claude auth login"
	case "gh":
		return "sudo -iu " + username + " gh auth login"
	case "cf":
		return "sudo -iu " + username + " cf auth login --no-browser"
	}
	return "sudo -iu " + username + " " + name
}

// loreSignedInWarning is what a signed-in lore CLI on the jobs user says.
func loreSignedInWarning(account, username string) string {
	who := ""
	if account != "" {
		who = " as " + account
	}
	return fmt.Sprintf("the jobs user's lore CLI is signed in%s: a job would reach past its key's pins (sudo -iu %s lore logout)", who, username)
}

/*
requireSignedIn fails a job at once, before any git and before its agent
starts, when a tool it needs says it is signed out: its agent CLI, and gh for a
read or write job, since the mirror fetches through it. It reads a fresh
probe, never the inventory's ten-minute cache. A tool the job does not need
never fails it, and an unknown sign-in lets it run.
*/
func (r *processRunner) requireSignedIn(ctx context.Context, u *user.User, spec jobSpec) error {
	if spec.Kind != jobKindAgent {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	needs := []string{spec.Agent}
	if spec.Source.mode() != sourceNone {
		needs = append(needs, "gh")
	}
	for _, name := range needs {
		binary := name
		if a, ok := agentAdapters[name]; ok {
			binary = a.Binary
		}
		if _, err := r.lookPath(u.HomeDir, binary); err != nil {
			continue
		}
		if in, _ := r.signInOf(ctx, u, name); in != nil && !*in {
			return fmt.Errorf("the jobs user's %s CLI is signed out: %s", name, signInCommand(name, u.Username))
		}
	}
	return nil
}
