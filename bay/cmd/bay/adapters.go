package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

/*
Agent adapters (#Q4219): the one place an agent CLI is named.

A job's spec names an adapter by `agent`; Bay finds its binary on the jobs
user's PATH and builds the command line from the adapter's template, so
nothing Lore sends is ever an argument list. The log is the agent's raw
stdout and stderr and the status its exit code; the one thing Bay reads from
what it prints is its final reply (#Q4288), which the adapter's Result finds
in the stream and the terminal ack carries.

An adapter is:
  - the binary, and the directories under the user's home an installer puts
    it in (on top of the system's);
  - the arguments that print its version;
  - the arguments of a non-interactive run: the prompt, the model when the
    spec names one (left out, the CLI's own default applies), and the flag
    that lets it work unattended in its directory;
  - how it is given Lore's MCP server: the endpoint, with
    `Authorization: Bearer ${LORE_JOB_KEY}`. The key itself travels in the
    run's environment only, which both CLIs expand in their MCP config, so
    it is never on a command line `ps` shows nor in a file;
  - the environment it runs with beyond the job's own;
  - how its final reply is read from its stream (Result).

Adding a CLI (Codex, Copilot) is one entry here, and its test.
*/
type agentAdapter struct {
	// Name is what a spec's `agent` says, and what the inventory reports.
	Name string
	// Binary is the executable looked up on the jobs user's PATH.
	Binary string
	// HomeBin is where its installers put the binary, under the user's home.
	HomeBin []string
	// VersionArgs print its version.
	VersionArgs []string
	// Env is set on every run of it.
	Env []string
	// Args is the command line of a run. `mcp` is nil for a run that is
	// given no MCP server (a check).
	Args func(run agentRun) []string
	// Prepare writes what a run needs outside its workspace, answering the
	// environment that points the CLI at it and how to remove it. Nil when
	// the CLI takes everything on its command line.
	Prepare func(run agentRun) (env []string, cleanup func(), err error)
	// Sessions says the CLI starts and resumes a named conversation
	// (#Q4250); without it a run's session is ignored, and every turn is new.
	Sessions bool
	// Result reads a run's final reply from its stdout (#Q4288): a fresh
	// reader per run. Nil for a CLI whose reply Bay cannot read.
	Result func() resultReader
}

// agentRun is what an adapter builds a run from.
type agentRun struct {
	Prompt string
	Model  string
	// MCPURL is Lore's MCP endpoint; empty for a run with no MCP server.
	MCPURL string
	// JSON asks for the CLI's single JSON result instead of its stream
	// (#Q4250): a chat agent's answer is read from it when the job ends.
	JSON bool
	// SessionID names the conversation the run starts, or continues when
	// Resume is set (#Q4250), on a CLI whose adapter has Sessions.
	SessionID string
	Resume    bool
}

// jobKeyEnv is the variable the job key travels in, which the adapters'
// MCP configs reference.
const jobKeyEnv = "LORE_JOB_KEY"

// mcpServerName is the name Lore's MCP server takes in every agent's config.
const mcpServerName = "lore"

var agentAdapters = map[string]agentAdapter{
	// Claude Code (`claude`): `-p` runs one prompt and exits; stream-json
	// makes each message and tool call a line of the log as it happens. The
	// MCP config is inline JSON, and `--strict-mcp-config` keeps any other
	// the jobs user has configured out of the run.
	"claude": {
		Name:        "claude",
		Binary:      "claude",
		HomeBin:     []string{".local/bin", ".claude/local", ".npm-global/bin", "bin"},
		VersionArgs: []string{"--version"},
		// Telemetry and update checks: nothing a job needs.
		Env:      []string{"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1", "DISABLE_AUTOUPDATER=1"},
		Sessions: true,
		Result:   func() resultReader { return &claudeResult{} },
		Args: func(run agentRun) []string {
			args := []string{"-p", run.Prompt, "--output-format", "stream-json", "--verbose",
				"--permission-mode", "bypassPermissions"}
			if run.JSON {
				// One JSON object at the end, its `result` the answer.
				args = []string{"-p", run.Prompt, "--output-format", "json",
					"--permission-mode", "bypassPermissions"}
			}
			if run.Model != "" {
				args = append(args, "--model", run.Model)
			}
			if run.SessionID != "" && run.Resume {
				args = append(args, "--resume", run.SessionID)
			} else if run.SessionID != "" {
				args = append(args, "--session-id", run.SessionID)
			}
			if run.MCPURL != "" {
				args = append(args, "--mcp-config", string(claudeMCPConfig(run.MCPURL)), "--strict-mcp-config")
			}
			return args
		},
	},
	// Gemini CLI (`gemini`): `-p` runs one prompt and exits, yolo approves
	// every tool call, `--skip-trust` trusts the workspace for this run only.
	// It reads MCP servers from settings, never from a flag, so the run gets
	// a system settings file of its own (GEMINI_CLI_SYSTEM_SETTINGS_PATH),
	// outside the workspace, and `--allowed-mcp-server-names` keeps any
	// other server the jobs user has configured out of the run.
	"gemini": {
		Name:        "gemini",
		Binary:      "gemini",
		HomeBin:     []string{".local/bin", ".npm-global/bin", "bin"},
		VersionArgs: []string{"--version"},
		Result:      func() resultReader { return &geminiResult{} },
		Args: func(run agentRun) []string {
			format := "stream-json"
			if run.JSON {
				format = "json"
			}
			args := []string{"-p", run.Prompt, "--output-format", format,
				"--approval-mode", "yolo", "--skip-trust"}
			if run.Model != "" {
				args = append(args, "--model", run.Model)
			}
			if run.MCPURL != "" {
				args = append(args, "--allowed-mcp-server-names", mcpServerName)
			}
			return args
		},
		Prepare: func(run agentRun) ([]string, func(), error) {
			if run.MCPURL == "" {
				return nil, func() {}, nil
			}
			path, cleanup, err := writeRunFile("bay-gemini-*.json", geminiSettings(run.MCPURL))
			if err != nil {
				return nil, nil, err
			}
			return []string{"GEMINI_CLI_SYSTEM_SETTINGS_PATH=" + path}, cleanup, nil
		},
	},
}

// adapterFor answers the adapter a spec names, or the list of the ones this
// bay has.
func adapterFor(name string) (agentAdapter, error) {
	if a, ok := agentAdapters[name]; ok {
		return a, nil
	}
	return agentAdapter{}, fmt.Errorf("unknown agent %q: this bay runs %s", name, strings.Join(adapterNames(), ", "))
}

func adapterNames() []string {
	names := make([]string, 0, len(agentAdapters))
	for name := range agentAdapters {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// claudeMCPConfig is Claude Code's MCP config: Lore's server and nothing
// else, the key expanded from the run's environment.
func claudeMCPConfig(url string) []byte {
	raw, _ := json.Marshal(map[string]any{
		"mcpServers": map[string]any{
			mcpServerName: map[string]any{
				"type":    "http",
				"url":     url,
				"headers": map[string]string{"Authorization": "Bearer ${" + jobKeyEnv + "}"},
			},
		},
	})
	return raw
}

// geminiSettings is the Gemini CLI settings a run is pointed at: Lore's
// server over streamable HTTP, the key expanded from the run's environment.
func geminiSettings(url string) []byte {
	raw, _ := json.Marshal(map[string]any{
		"mcpServers": map[string]any{
			mcpServerName: map[string]any{
				"httpUrl": url,
				"headers": map[string]string{"Authorization": "Bearer ${" + jobKeyEnv + "}"},
			},
		},
	})
	return raw
}

/*
writeRunFile writes a file a run reads, outside its workspace: a fresh,
randomly named file in the system's temporary directory (O_EXCL, so nothing
planted there is followed), readable by the jobs user. It holds no secret,
only a reference to the key's variable.
*/
func writeRunFile(pattern string, content []byte) (string, func(), error) {
	f, err := os.CreateTemp("", pattern)
	if err != nil {
		return "", nil, err
	}
	path := f.Name()
	cleanup := func() { _ = os.Remove(path) }
	if _, err := f.Write(content); err != nil {
		f.Close()
		cleanup()
		return "", nil, err
	}
	if err := f.Close(); err != nil {
		cleanup()
		return "", nil, err
	}
	if err := os.Chmod(path, 0o644); err != nil {
		cleanup()
		return "", nil, err
	}
	return filepath.Clean(path), cleanup, nil
}

// jobTools are the tools beside the agent CLIs a job may need, which the
// inventory reports (#Q4220): git and gh for work on a repository, cf
// (Cloudflare's CLI, #Q4254) for a deploy, lore for a prompt that asks for
// the CLI. Bay runs git for a job's source (#E173) and none of the others.
var jobTools = []string{"git", "gh", "cf", "lore"}

/*
cfIsCloudflares tells Cloudflare's `cf` from another program installed under
the same name: Cloud Foundry's CLI is `cf` too, and prints `cf version 8.7.0`
where Cloudflare's prints `cf · v0.15.0` under its mark. A version from the
wrong program would read as the right tool installed.
*/
func cfIsCloudflares(out string) bool {
	lower := strings.ToLower(out)
	return strings.Contains(lower, "cloudflare") || strings.Contains(out, "cf · v")
}
