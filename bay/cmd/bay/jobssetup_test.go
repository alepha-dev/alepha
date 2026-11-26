package main

import (
	"errors"
	"os"
	"os/user"
	"strings"
	"testing"

	"github.com/alepha-dev/bay/internal/connector"
)

/*
setupWorld is `bay jobs setup` on its seams (#Q4526): a user table the test
owns, the tools it says the jobs user has, and every create and sign-in it
was asked for.
*/
type setupWorld struct {
	t       *testing.T
	root    string
	users   map[string]*user.User
	tools   []connector.InventoryTool
	created []string
	logins  []string
	// afterLogin is what the tools read once a sign-in ran.
	afterLogin []connector.InventoryTool
	out        strings.Builder
}

func newSetupWorld(t *testing.T) *setupWorld {
	return &setupWorld{t: t, root: t.TempDir(), users: map[string]*user.User{}}
}

func (w *setupWorld) addUser(name, uid string) {
	w.users[name] = &user.User{Username: name, Uid: uid, Gid: uid, HomeDir: "/home/" + name}
}

func (w *setupWorld) setup() *jobsSetup {
	return &jobsSetup{
		root:    w.root,
		out:     &w.out,
		selfUID: 1000,
		lookup: func(name string) (*user.User, error) {
			if u, ok := w.users[name]; ok {
				return u, nil
			}
			return nil, user.UnknownUserError(name)
		},
		create: func(name string) error {
			w.created = append(w.created, name)
			w.addUser(name, "1500")
			return nil
		},
		tools: func(*user.User) []connector.InventoryTool { return w.tools },
		login: func(u *user.User, binary string, args []string) error {
			w.logins = append(w.logins, u.Username+" "+binary+" "+strings.Join(args, " "))
			if w.afterLogin != nil {
				w.tools = w.afterLogin
			}
			return nil
		},
	}
}

func readyTools() []connector.InventoryTool {
	yes := true
	return []connector.InventoryTool{
		{Name: "claude", Kind: "agent", Found: true, Version: "2.1.7", SignedIn: &yes},
		{Name: "gemini", Kind: "agent"},
		{Name: "git", Kind: "tool", Found: true, Version: "2.43.0"},
		{Name: "gh", Kind: "tool", Found: true, Version: "2.60.0", SignedIn: &yes},
		{Name: "cf", Kind: "tool"},
		{Name: "lore", Kind: "tool"},
		{Name: "playwright-cli", Kind: "tool"},
	}
}

func TestJobsSetup(t *testing.T) {
	t.Run("creates bay-agent when no jobs user is configured, and saves it", func(t *testing.T) {
		w := newSetupWorld(t)
		w.tools = readyTools()

		if err := w.setup().run(""); err != nil {
			t.Fatalf("setup: %v\n%s", err, w.out.String())
		}
		if strings.Join(w.created, ",") != "bay-agent" {
			t.Fatalf("created = %v", w.created)
		}
		cfg, _ := loadJobsConfig(w.root)
		if cfg.User != "bay-agent" {
			t.Fatalf("saved user = %q", cfg.User)
		}
		if !strings.Contains(w.out.String(), "ready: agent jobs run as bay-agent") {
			t.Fatalf("output:\n%s", w.out.String())
		}
	})

	t.Run("takes an existing account named by --user without creating it", func(t *testing.T) {
		w := newSetupWorld(t)
		w.addUser("agents", "1400")
		w.tools = readyTools()

		if err := w.setup().run("agents"); err != nil {
			t.Fatalf("setup: %v", err)
		}
		if len(w.created) != 0 {
			t.Fatalf("created = %v", w.created)
		}
		if cfg, _ := loadJobsConfig(w.root); cfg.User != "agents" {
			t.Fatalf("saved user = %q", cfg.User)
		}
	})

	t.Run("keeps the user a host already has, and refuses another name", func(t *testing.T) {
		w := newSetupWorld(t)
		w.addUser("runner", "1300")
		if err := saveJobsConfig(w.root, jobsConfig{User: "runner", MaxJobs: 3}); err != nil {
			t.Fatal(err)
		}
		w.tools = readyTools()

		if err := w.setup().run(""); err != nil {
			t.Fatalf("setup: %v", err)
		}
		cfg, _ := loadJobsConfig(w.root)
		if cfg.User != "runner" || cfg.MaxJobs != 3 || len(w.created) != 0 {
			t.Fatalf("cfg = %+v, created = %v", cfg, w.created)
		}
		if err := w.setup().run("other"); err == nil || !strings.Contains(err.Error(), "bay config jobs --user other") {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("refuses root and Bay's own user, as bay config jobs does", func(t *testing.T) {
		w := newSetupWorld(t)
		w.addUser("root", "0")
		w.addUser("bay", "1000")
		for _, name := range []string{"root", "bay"} {
			if err := w.setup().run(name); err == nil {
				t.Fatalf("%s was accepted", name)
			}
		}
		if cfg, _ := loadJobsConfig(w.root); cfg.User != "" {
			t.Fatalf("saved user = %q", cfg.User)
		}
	})

	t.Run("refuses a name that is not a plain user name, and a lookup that failed for another reason", func(t *testing.T) {
		w := newSetupWorld(t)
		if err := w.setup().run("-r"); err == nil || len(w.created) != 0 {
			t.Fatalf("err = %v, created = %v", err, w.created)
		}
		s := w.setup()
		s.lookup = func(string) (*user.User, error) { return nil, errors.New("directory unreachable") }
		if err := s.run(""); err == nil || len(w.created) != 0 {
			t.Fatalf("err = %v, created = %v", err, w.created)
		}
	})

	t.Run("lists the install line of each missing tool, installs nothing, and exits non-zero", func(t *testing.T) {
		w := newSetupWorld(t)
		w.tools = []connector.InventoryTool{
			{Name: "claude", Kind: "agent"},
			{Name: "gemini", Kind: "agent"},
			{Name: "git", Kind: "tool", Found: true, Version: "2.43.0"},
			{Name: "gh", Kind: "tool"},
		}

		err := w.setup().run("")
		if err == nil {
			t.Fatal("a host with no agent CLI and no gh was said ready")
		}
		out := w.out.String()
		for _, want := range []string{"gh: install GitHub CLI", "claude: sudo -iu bay-agent", "gemini: sudo -iu bay-agent"} {
			if !strings.Contains(out, want) {
				t.Fatalf("output lacks %q:\n%s", want, out)
			}
		}
		if strings.Contains(out, "git: apt-get") {
			t.Fatalf("an installed git was listed:\n%s", out)
		}
		if len(w.logins) != 0 {
			t.Fatalf("logins = %v", w.logins)
		}
		if !strings.Contains(err.Error(), "gh missing") || !strings.Contains(err.Error(), "no agent CLI ready") {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("signs each signed-out tool in as the jobs user, the agent CLI first, then gh", func(t *testing.T) {
		w := newSetupWorld(t)
		no := false
		w.tools = []connector.InventoryTool{
			{Name: "claude", Kind: "agent", Found: true, Version: "2.1.7", SignedIn: &no},
			{Name: "git", Kind: "tool", Found: true, Version: "2.43.0"},
			{Name: "gh", Kind: "tool", Found: true, Version: "2.60.0", SignedIn: &no},
			{Name: "cf", Kind: "tool", Found: true, Version: "0.15.0", SignedIn: &no},
			{Name: "lore", Kind: "tool", Found: true, Version: "0.38.0", SignedIn: &no},
		}
		w.afterLogin = readyTools()

		if err := w.setup().run(""); err != nil {
			t.Fatalf("setup: %v\n%s", err, w.out.String())
		}
		want := "bay-agent claude auth login,bay-agent gh auth login --hostname github.com"
		if strings.Join(w.logins, ",") != want {
			t.Fatalf("logins = %v", w.logins)
		}
	})

	t.Run("exits non-zero while a sign-in did not take, so a second run picks it up", func(t *testing.T) {
		w := newSetupWorld(t)
		no := false
		w.tools = []connector.InventoryTool{
			{Name: "claude", Kind: "agent", Found: true, Version: "2.1.7", SignedIn: &no},
			{Name: "git", Kind: "tool", Found: true, Version: "2.43.0"},
			{Name: "gh", Kind: "tool", Found: true, Version: "2.60.0", SignedIn: &no},
		}
		s := w.setup()
		s.login = func(*user.User, string, []string) error { return errors.New("interrupted") }

		err := s.run("")
		if err == nil || !strings.Contains(err.Error(), "claude signed out") || !strings.Contains(err.Error(), "gh signed out") {
			t.Fatalf("err = %v", err)
		}
		if !strings.Contains(w.out.String(), "sign-in did not finish") {
			t.Fatalf("output:\n%s", w.out.String())
		}
	})

	t.Run("changes nothing on a second run of a ready host", func(t *testing.T) {
		w := newSetupWorld(t)
		w.tools = readyTools()
		if err := w.setup().run(""); err != nil {
			t.Fatal(err)
		}
		before, _ := os.ReadFile(w.root + "/" + jobsConfigFile)

		if err := w.setup().run(""); err != nil {
			t.Fatalf("second run: %v", err)
		}
		after, _ := os.ReadFile(w.root + "/" + jobsConfigFile)
		if string(before) != string(after) || len(w.created) != 1 || len(w.logins) != 0 {
			t.Fatalf("created = %v, logins = %v, config %s -> %s", w.created, w.logins, before, after)
		}
	})
}
