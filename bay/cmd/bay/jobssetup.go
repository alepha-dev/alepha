package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"os/user"
	"regexp"
	"strings"

	"github.com/alepha-dev/bay/internal/connector"
)

/*
`bay jobs setup` makes a host ready for agent jobs in one guided, idempotent
command (#Q4526), where it took six hand steps:

 1. the jobs user: when jobs.json names none, `bay-agent` (or `--user NAME`)
    is created with `useradd --create-home` when it does not exist, checked
    by checkJobsUser and saved. A host already configured keeps its user;
 2. the tools: each required tool the jobs user lacks (git, gh, at least one
    agent CLI) is listed with the line that installs it for that user.
    Setup installs nothing;
 3. the sign-ins: each installed tool that says it is signed out logs in as
    the jobs user on the caller's terminal, the agent CLIs first, then gh.
    lore is reported as doctor reports it, never signed out here;
 4. the result: the doctor's tool list, and a non-zero exit while a required
    tool is missing or signed out, so a second run picks up where the first
    stopped.

The operator's own steps are the two sign-ins, which need a human; the rest
is this command's.
*/

const jobsSetupUsage = "usage: bay jobs setup [--user NAME] [--root DIR]"

// defaultJobsUser is the account setup creates when none is named.
const defaultJobsUser = "bay-agent"

// jobsUserName is what a name setup may create looks like, so no flag ever
// reaches useradd as a name.
var jobsUserName = regexp.MustCompile(`^[a-z_][a-z0-9_-]{0,31}$`)

// jobsSetup is the command's state, its seams for the tests: a test cannot
// create users, switch to one or open a terminal.
type jobsSetup struct {
	root    string
	out     io.Writer
	selfUID int
	// lookup resolves a user by name.
	lookup func(name string) (*user.User, error)
	// create makes a user with a home directory.
	create func(name string) error
	// tools reads the jobs user's tools, the inventory's list.
	tools func(u *user.User) []connector.InventoryTool
	// login runs a tool's own sign-in as the jobs user, on the caller's
	// terminal.
	login func(u *user.User, binary string, args []string) error
}

// cmdJobsSetup is `bay jobs setup`.
func cmdJobsSetup(args []string) error {
	root, _ := resolveRoot(args, defaultRoot)
	name := ""
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--user":
			if i+1 >= len(args) {
				return errors.New(jobsSetupUsage)
			}
			i++
			name = args[i]
		case "--root", "--control-socket":
			i++
		default:
			return errors.New(jobsSetupUsage)
		}
	}
	r := newProcessRunner(root)
	if !r.switchUser && !r.testRunAsSelf {
		return errors.New("bay jobs setup creates a user and signs its tools in as that user: run it as root (sudo bay jobs setup)")
	}
	s := &jobsSetup{
		root:    root,
		out:     os.Stdout,
		selfUID: os.Getuid(),
		lookup:  user.Lookup,
		create: func(name string) error {
			cmd := exec.Command("useradd", "--create-home", "--", name)
			cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
			return cmd.Run()
		},
		tools: func(u *user.User) []connector.InventoryTool {
			return r.tools(context.Background(), u)
		},
		login: func(u *user.User, binary string, args []string) error {
			return r.interactive(u, binary, args)
		},
	}
	return s.run(name)
}

// run is the whole setup, on its seams.
func (s *jobsSetup) run(name string) error {
	u, err := s.jobsUser(name)
	if err != nil {
		return err
	}

	tools := s.tools(u)
	if missing := setupMissing(tools, u.Username); len(missing) > 0 {
		fmt.Fprintf(s.out, "\nmissing for %s (setup installs nothing, run these and then setup again):\n", u.Username)
		for _, line := range missing {
			fmt.Fprintf(s.out, "  %s\n", line)
		}
	}

	signedIn := false
	for _, t := range setupLogins(tools) {
		args := setupLoginArgs(t.Name)
		fmt.Fprintf(s.out, "\n%s is signed out for %s: signing it in (%s %s)\n", t.Name, u.Username, t.Name, strings.Join(args, " "))
		if err := s.login(u, setupBinary(t.Name), args); err != nil {
			fmt.Fprintf(s.out, "  %s sign-in did not finish: %v (run setup again, or %s)\n", t.Name, err, signInCommand(t.Name, u.Username))
		}
		signedIn = true
	}
	if signedIn {
		tools = s.tools(u)
	}

	fmt.Fprintln(s.out)
	printChecks(s.out, toolChecks(tools, u.Username))
	if blocking := setupBlocking(tools); len(blocking) > 0 {
		return fmt.Errorf("not ready for agent jobs yet: %s; run `bay jobs setup` again once done", strings.Join(blocking, ", "))
	}
	fmt.Fprintf(s.out, "\nready: agent jobs run as %s; `bay config jobs` sets how many at once\n", u.Username)
	return nil
}

// jobsUser answers the configured user, or makes and saves one.
func (s *jobsSetup) jobsUser(name string) (*user.User, error) {
	cfg, err := loadJobsConfig(s.root)
	if err != nil {
		return nil, fmt.Errorf("the jobs config is unreadable: %w", err)
	}
	if cfg.User != "" {
		if name != "" && name != cfg.User {
			return nil, fmt.Errorf("this host runs jobs as %s already: `bay config jobs --user %s` changes it", cfg.User, name)
		}
		u, err := s.lookup(cfg.User)
		if err != nil {
			return nil, fmt.Errorf("the jobs user %q is configured but does not exist: create it (useradd --create-home %s) or clear it (bay config jobs --clear)", cfg.User, cfg.User)
		}
		if err := checkJobsUser(u, s.selfUID); err != nil {
			return nil, err
		}
		fmt.Fprintf(s.out, "jobs user: %s, already configured\n", u.Username)
		return u, nil
	}
	if name == "" {
		name = defaultJobsUser
	}
	if !jobsUserName.MatchString(name) {
		return nil, fmt.Errorf("%q is not a user name setup creates: lowercase letters, digits, - and _, starting with a letter or _", name)
	}
	u, err := s.lookup(name)
	created := false
	var unknown user.UnknownUserError
	if err != nil && !errors.As(err, &unknown) {
		// A directory that did not answer is not an absent user: creating a
		// local one could shadow it.
		return nil, fmt.Errorf("could not look the user %s up: %w", name, err)
	}
	if err != nil {
		if err := s.create(name); err != nil {
			return nil, fmt.Errorf("could not create the user %s: %w", name, err)
		}
		if u, err = s.lookup(name); err != nil {
			return nil, fmt.Errorf("the user %s was created but cannot be found: %w", name, err)
		}
		created = true
	}
	if err := checkJobsUser(u, s.selfUID); err != nil {
		return nil, err
	}
	cfg.User = u.Username
	if err := saveJobsConfig(s.root, cfg); err != nil {
		return nil, err
	}
	if created {
		fmt.Fprintf(s.out, "jobs user: %s, created and saved\n", u.Username)
	} else {
		fmt.Fprintf(s.out, "jobs user: %s, an existing account, saved\n", u.Username)
	}
	return u, nil
}

// setupMissing lists the install line of each required tool the user lacks:
// git, gh, and an agent CLI when none is installed.
func setupMissing(tools []connector.InventoryTool, username string) []string {
	var lines []string
	agents := 0
	for _, t := range tools {
		if t.Kind == "agent" && t.Found {
			agents++
		}
	}
	for _, t := range tools {
		if t.Found {
			continue
		}
		switch {
		case t.Name == "git":
			lines = append(lines, "git: apt-get install git (or your distribution's package)")
		case t.Name == "gh":
			lines = append(lines, "gh: install GitHub CLI for every user, https://cli.github.com (apt-get install gh)")
		}
	}
	if agents == 0 {
		lines = append(lines,
			"an agent CLI, one of:",
			"  claude: sudo -iu "+username+" bash -c 'curl -fsSL https://claude.ai/install.sh | bash'",
			"  gemini: sudo -iu "+username+" bash -c 'npm install --prefix ~/.npm-global -g @google/gemini-cli'")
	}
	return lines
}

// setupLogins is the tools whose sign-in setup runs: every installed agent
// CLI that says it is signed out, then gh. Never lore, never cf.
func setupLogins(tools []connector.InventoryTool) []connector.InventoryTool {
	var agents, rest []connector.InventoryTool
	for _, t := range tools {
		if !t.Found || t.Error != "" || t.SignedIn == nil || *t.SignedIn {
			continue
		}
		switch {
		case t.Kind == "agent":
			agents = append(agents, t)
		case t.Name == "gh":
			rest = append(rest, t)
		}
	}
	return append(agents, rest...)
}

// setupLoginArgs is a tool's own sign-in command line. Only a tool whose
// sign-in Bay can read reaches it (signins.go): claude and gh today; an agent
// CLI with no status command, such as gemini, is never asked.
func setupLoginArgs(name string) []string {
	if name == "gh" {
		return []string{"auth", "login", "--hostname", "github.com"}
	}
	return []string{"auth", "login"}
}

// setupBinary is the executable of a tool, an agent CLI's by its adapter.
func setupBinary(name string) string {
	if a, ok := agentAdapters[name]; ok {
		return a.Binary
	}
	return name
}

// setupBlocking names what keeps the host from running agent jobs: a
// required tool missing, or one that says it is signed out.
func setupBlocking(tools []connector.InventoryTool) []string {
	var out []string
	agents := 0
	for _, t := range tools {
		signedOut := t.SignedIn != nil && !*t.SignedIn
		switch {
		case t.Kind == "agent" && t.Found && t.Error == "" && !signedOut:
			agents++
		case t.Kind == "agent" && t.Found && signedOut:
			out = append(out, t.Name+" signed out")
		case (t.Name == "git" || t.Name == "gh") && !t.Found:
			out = append(out, t.Name+" missing")
		case t.Name == "gh" && signedOut:
			out = append(out, "gh signed out")
		}
	}
	if agents == 0 {
		out = append(out, "no agent CLI ready")
	}
	return out
}

/*
interactive runs a tool as the jobs user on the caller's terminal, for its
sign-in: stdin, stdout and stderr are the caller's, and the environment is
the user's own with the caller's TERM, without the job environment's CI and
GIT_TERMINAL_PROMPT, which tell a CLI that nobody is there to answer.
*/
func (r *processRunner) interactive(u *user.User, binary string, args []string) error {
	bin, err := r.lookPath(u.HomeDir, binary)
	if err != nil {
		return err
	}
	env := []string{
		"HOME=" + u.HomeDir,
		"USER=" + u.Username,
		"LOGNAME=" + u.Username,
		"PATH=" + strings.Join(r.pathDirs(u.HomeDir), ":"),
		"LANG=C.UTF-8",
	}
	if term := os.Getenv("TERM"); term != "" {
		env = append(env, "TERM="+term)
	}
	if a, ok := agentAdapters[binary]; ok {
		env = append(env, a.Env...)
	}
	cmd, err := r.command(context.Background(), u, u.HomeDir, bin, args, env)
	if err != nil {
		return err
	}
	// The caller's terminal, not a process group of its own: a sign-in reads
	// the keyboard, which only the foreground group may.
	foreground(cmd.SysProcAttr)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	// Ctrl-C ends the sign-in, not setup: the tool gets it, setup carries on
	// and reports that the sign-in did not finish.
	signal.Ignore(os.Interrupt)
	defer signal.Reset(os.Interrupt)
	return cmd.Run()
}
