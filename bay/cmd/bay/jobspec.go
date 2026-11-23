package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

/*
jobSpec is what a `job-run` asks this machine to run, pulled by command id
(#Q3983). It is structured on purpose and is never an argument list: Bay
builds the command line from these fields itself (claudeArgs), so a field
that arrives with a value this file does not accept refuses the whole job,
and nothing Lore sends is executed as written.

It is runner-agnostic: the process runner reads all of it but `image` and
`egress`, which a container runner enforces. The process runner carries the
egress list without enforcing it, which is why a host that runs process jobs
must do nothing else.

Unknown fields refuse the spec too (DisallowUnknownFields): a Lore that sends
a field this Bay does not know is asking for something this Bay would not do.
*/
type jobSpec struct {
	// Kind is `agent` (Claude Code against a clone) or `check` (Claude Code
	// asked to reply OK, the capability check, with no clone and no tools).
	Kind string `json:"kind"`
	// Profile is one of the three fixed permission profiles: `check`,
	// `read` or `push`. Lore picks it; Bay checks it agrees with the kind
	// and the flags.
	Profile    string         `json:"profile"`
	Repository *jobRepository `json:"repository,omitempty"`
	// Key is the job key: the credential the clone and Lore's MCP use, and
	// nothing else. Revoked by Lore when the job ends.
	Key string `json:"key,omitempty"`
	// MCPURL is Lore's MCP endpoint, written to the job's `.mcp.json`.
	MCPURL string `json:"mcpUrl,omitempty"`
	// Prompt is the rendered prompt of an agent job. A check takes none: Bay
	// asks its own fixed question.
	Prompt         string `json:"prompt,omitempty"`
	MaxTurns       int    `json:"maxTurns"`
	TimeoutSeconds int    `json:"timeoutSeconds"`
	// AllowedTools and DisallowedTools are Claude Code tool names, checked
	// one by one against toolPattern, never a raw flag string.
	AllowedTools    []string `json:"allowedTools,omitempty"`
	DisallowedTools []string `json:"disallowedTools,omitempty"`
	// PermissionMode is Claude Code's, from a short list that never holds
	// `bypassPermissions`.
	PermissionMode string `json:"permissionMode,omitempty"`
	// Egress is the hosts the job may reach. Carried, and enforced only by a
	// container runner's proxy.
	Egress []string `json:"egress,omitempty"`
	// Image is the agent image by digest, read by a container runner only.
	Image string `json:"image,omitempty"`
}

// jobRepository is what an agent job clones: a URL on the Lore this machine
// is connected to, and a ref.
type jobRepository struct {
	CloneURL string `json:"cloneUrl"`
	Ref      string `json:"ref"`
}

const (
	jobKindAgent = "agent"
	jobKindCheck = "check"

	jobProfileCheck = "check"
	jobProfileRead  = "read"
	jobProfilePush  = "push"

	// maxJobPrompt bounds a prompt: it travels as one argument to claude,
	// and a prompt this long is a bug or an attack, not a task.
	maxJobPrompt = 128 << 10
	// maxJobTools bounds each tool list.
	maxJobTools = 64
	// maxJobEgress bounds the egress list.
	maxJobEgress = 50
	// The bounds on a job's budget. A check is one turn and a short wait.
	maxJobTurns          = 500
	minJobTimeoutSeconds = 10
	maxJobTimeoutSeconds = 4 * 3600
	maxCheckTimeout      = 300

	// checkPrompt is the whole of what a capability check asks: an empty
	// prompt makes claude error, and this one costs one short turn.
	checkPrompt = "reply OK"
)

var (
	// toolPattern is a Claude Code tool name: a bare name (`Read`, `Grep`),
	// an MCP tool (`mcp__lore__quest_get`), or a Bash rule with a bounded
	// pattern and no parentheses or line break inside (`Bash(git log:*)`).
	toolPattern = regexp.MustCompile(`^(?:[A-Z][A-Za-z0-9]{0,63}|mcp__[a-z0-9_-]{1,64}__[a-z0-9_]{1,64}|Bash\([^()\r\n,]{1,200}\))$`)
	// modelPattern is a Claude model name `bay config jobs --model` takes:
	// an alias (`opus`, `sonnet[1m]`) or an id (`claude-opus-5-5`), never
	// a leading dash or anything a shell or flag parser would read.
	modelPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9.\-]{0,79}(?:\[1m\])?$`)
	// refPattern is a git ref name a clone may take: no `..`, no leading
	// dash (an option), nothing but the characters a branch uses.
	refPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$`)
	// keyPattern is a job key as Lore mints it.
	keyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{16,256}$`)
	// digestPattern is an image named by digest, the only way a job names one.
	digestPattern = regexp.MustCompile(`^(?:[a-z0-9./_-]{1,200}@)?sha256:[0-9a-f]{64}$`)

	jobPermissionModes = map[string]bool{"": true, "default": true, "acceptEdits": true}
)

/*
parseJobSpec decodes and validates a pulled spec against the sink this
machine is connected to. Every URL in it must be on that sink's origin: the
job key goes to Lore, and to nothing else.
*/
func parseJobSpec(raw []byte, sink string) (jobSpec, error) {
	var spec jobSpec
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&spec); err != nil {
		return jobSpec{}, fmt.Errorf("the job spec is not one this bay reads: %w", err)
	}
	if dec.More() {
		return jobSpec{}, errors.New("the job spec holds more than one document")
	}
	if err := spec.validate(sink); err != nil {
		return jobSpec{}, err
	}
	return spec, nil
}

func (spec jobSpec) validate(sink string) error {
	switch spec.Kind {
	case jobKindAgent:
		if spec.Profile != jobProfileRead && spec.Profile != jobProfilePush {
			return fmt.Errorf("an agent job runs the read or push profile, not %q", spec.Profile)
		}
		if spec.Repository == nil {
			return errors.New("an agent job names a repository to clone")
		}
		if err := sameOrigin(spec.Repository.CloneURL, sink); err != nil {
			return fmt.Errorf("the clone URL: %w", err)
		}
		if !refPattern.MatchString(spec.Repository.Ref) || strings.Contains(spec.Repository.Ref, "..") {
			return fmt.Errorf("the ref %q is not a ref this bay clones", spec.Repository.Ref)
		}
		if !keyPattern.MatchString(spec.Key) {
			return errors.New("an agent job carries a job key")
		}
		if err := sameOrigin(spec.MCPURL, sink); err != nil {
			return fmt.Errorf("the MCP URL: %w", err)
		}
		if strings.TrimSpace(spec.Prompt) == "" {
			return errors.New("an agent job carries a prompt")
		}
		if len(spec.Prompt) > maxJobPrompt {
			return fmt.Errorf("the prompt is %d bytes, over the %d this bay passes to claude", len(spec.Prompt), maxJobPrompt)
		}
		if strings.ContainsRune(spec.Prompt, 0) {
			return errors.New("the prompt holds a NUL byte")
		}
		if spec.MaxTurns < 1 || spec.MaxTurns > maxJobTurns {
			return fmt.Errorf("maxTurns %d is outside 1 to %d", spec.MaxTurns, maxJobTurns)
		}
		if spec.TimeoutSeconds < minJobTimeoutSeconds || spec.TimeoutSeconds > maxJobTimeoutSeconds {
			return fmt.Errorf("timeoutSeconds %d is outside %d to %d", spec.TimeoutSeconds, minJobTimeoutSeconds, maxJobTimeoutSeconds)
		}
	case jobKindCheck:
		if spec.Profile != jobProfileCheck {
			return fmt.Errorf("a check runs the check profile, not %q", spec.Profile)
		}
		// A check asks its fixed question with nothing in reach: no clone, no
		// key, no tools, no prompt of Lore's.
		if spec.Repository != nil || spec.Key != "" || spec.MCPURL != "" || spec.Prompt != "" ||
			len(spec.AllowedTools) > 0 || len(spec.DisallowedTools) > 0 || spec.PermissionMode != "" {
			return errors.New("a check carries no repository, key, MCP URL, prompt or tool flag")
		}
		if spec.MaxTurns != 1 {
			return errors.New("a check is one turn")
		}
		if spec.TimeoutSeconds < minJobTimeoutSeconds || spec.TimeoutSeconds > maxCheckTimeout {
			return fmt.Errorf("a check's timeoutSeconds %d is outside %d to %d", spec.TimeoutSeconds, minJobTimeoutSeconds, maxCheckTimeout)
		}
	default:
		return fmt.Errorf("unknown job kind %q: this bay runs %s and %s jobs", spec.Kind, jobKindAgent, jobKindCheck)
	}

	for _, list := range [][]string{spec.AllowedTools, spec.DisallowedTools} {
		if len(list) > maxJobTools {
			return fmt.Errorf("a tool list holds %d names, over %d", len(list), maxJobTools)
		}
		for _, tool := range list {
			if !toolPattern.MatchString(tool) {
				return fmt.Errorf("%q is not a tool name this bay passes to claude", tool)
			}
		}
	}
	if !jobPermissionModes[spec.PermissionMode] {
		return fmt.Errorf("permission mode %q is not one this bay passes to claude", spec.PermissionMode)
	}
	if spec.Profile == jobProfileRead && spec.PermissionMode == "acceptEdits" {
		return errors.New("the read profile does not accept edits")
	}
	if len(spec.Egress) > maxJobEgress {
		return fmt.Errorf("the egress list holds %d hosts, over %d", len(spec.Egress), maxJobEgress)
	}
	for _, host := range spec.Egress {
		if len(host) > 253 || !hostPattern.MatchString(host) {
			return fmt.Errorf("egress entry %q is not a bare host name", host)
		}
	}
	if spec.Image != "" && !digestPattern.MatchString(spec.Image) {
		return fmt.Errorf("the image %q is not named by digest", spec.Image)
	}
	return nil
}

// sameOrigin refuses a URL that is not on the sink's scheme, host and port.
func sameOrigin(raw, sink string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil {
		return fmt.Errorf("%q is not an http(s) URL", raw)
	}
	s, err := url.Parse(sink)
	if err != nil {
		return fmt.Errorf("the sink %q does not parse", sink)
	}
	if u.Scheme != s.Scheme || !strings.EqualFold(u.Host, s.Host) {
		return fmt.Errorf("%q is not on %s://%s, the Lore this bay is connected to", raw, s.Scheme, s.Host)
	}
	return nil
}

/*
claudeArgs is the command line, built here and only here.

An agent job streams JSON (`--output-format stream-json --verbose`) so each
tool call and message is a line of the log as it happens; a check streams too,
for its init line (version, model, credential kind) and its result. The MCP config is the file Bay wrote, and `--strict-mcp-config`
keeps any other the jobs user has configured out of the run. Tool lists are
joined with commas into one argument each: a Bash rule may hold a space, and
toolPattern refuses a comma inside one.
*/
func claudeArgs(spec jobSpec, mcpConfig, model string) []string {
	// The host's model (#Q4204), on the check too: the Agent host card then
	// reports the model the jobs really run with.
	var modelArgs []string
	if model != "" {
		modelArgs = []string{"--model", model}
	}
	if spec.Kind == jobKindCheck {
		// stream-json rather than json: its init line is what says the CLI's
		// version, the model and where the credential came from (#Q3985).
		return append([]string{"-p", checkPrompt, "--max-turns", "1", "--output-format", "stream-json", "--verbose"}, modelArgs...)
	}
	args := []string{"-p", spec.Prompt,
		"--output-format", "stream-json", "--verbose",
		"--max-turns", fmt.Sprint(spec.MaxTurns),
		"--mcp-config", mcpConfig, "--strict-mcp-config",
	}
	args = append(args, modelArgs...)
	if len(spec.AllowedTools) > 0 {
		args = append(args, "--allowedTools", strings.Join(spec.AllowedTools, ","))
	}
	if len(spec.DisallowedTools) > 0 {
		args = append(args, "--disallowedTools", strings.Join(spec.DisallowedTools, ","))
	}
	if spec.PermissionMode != "" {
		args = append(args, "--permission-mode", spec.PermissionMode)
	}
	return args
}

// mcpConfigJSON is the `.mcp.json` an agent job runs with: Lore's MCP and
// nothing else, authenticated by the job key.
func mcpConfigJSON(spec jobSpec) ([]byte, error) {
	return json.MarshalIndent(map[string]any{
		"mcpServers": map[string]any{
			"lore": map[string]any{
				"type":    "http",
				"url":     spec.MCPURL,
				"headers": map[string]string{"Authorization": "Bearer " + spec.Key},
			},
		},
	}, "", "  ")
}
