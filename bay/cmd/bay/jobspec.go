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
builds the command line from these fields and the adapter the spec names
(adapters.go), so a field that arrives with a value this file does not accept
refuses the whole job, and nothing Lore sends is executed as written.

Unknown fields refuse the spec too (DisallowUnknownFields): a Lore that sends
a field this Bay does not know is asking for something this Bay would not do.
*/
type jobSpec struct {
	// Kind is `agent` (a prompt run in a workspace) or `check` (the
	// capability check: the agent's version, then a one-line prompt, with
	// no workspace and no MCP server).
	Kind string `json:"kind"`
	// Agent names the adapter: `claude`, `gemini` (#Q4219).
	Agent string `json:"agent"`
	// Model is passed to the agent when present; absent, its own default
	// applies.
	Model string `json:"model,omitempty"`
	// Project and Workspace name the directory an agent job runs in,
	// `<jobs base>/<project>/<workspace>` (#Q4218): created on first use and
	// kept, so the first run clones and the next ones pull. Bay does no git:
	// what the directory holds is the agent's business.
	Project   string `json:"project,omitempty"`
	Workspace string `json:"workspace,omitempty"`
	// Key is the job key: the credential Lore's MCP takes, and nothing
	// else. Revoked by Lore when the job ends. It reaches the agent in its
	// environment only.
	Key string `json:"key,omitempty"`
	// MCPURL is Lore's MCP endpoint, given to the agent with the key.
	MCPURL string `json:"mcpUrl,omitempty"`
	// Prompt is the rendered prompt of an agent job. A check takes none: Bay
	// asks its own fixed question.
	Prompt         string `json:"prompt,omitempty"`
	TimeoutSeconds int    `json:"timeoutSeconds"`
}

const (
	jobKindAgent = "agent"
	jobKindCheck = "check"

	// maxJobPrompt bounds a prompt: it travels as one argument to the agent,
	// and a prompt this long is a bug or an attack, not a task.
	maxJobPrompt = 128 << 10
	// The bounds on a job's time. A check is a short wait.
	minJobTimeoutSeconds = 10
	maxJobTimeoutSeconds = 4 * 3600
	maxCheckTimeout      = 300

	// checkPrompt is the whole of what a capability check asks: one short
	// answer, which tells the agent is installed AND signed in.
	checkPrompt = "reply OK"
)

var (
	// modelPattern is a model name passed to an agent: an alias (`opus`,
	// `sonnet[1m]`, `flash`) or an id (`claude-opus-5-5`, `gemini-2.5-pro`),
	// never a leading dash or anything a shell or flag parser would read.
	modelPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9.\-]{0,79}(?:\[1m\])?$`)
	// namePattern is a project slug or a workspace key: one path segment, no
	// leading dot or dash, so it can neither climb out of the jobs base nor
	// read as an option.
	namePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,62}$`)
	// keyPattern is a job key as Lore mints it.
	keyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{16,256}$`)
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
	if _, err := adapterFor(spec.Agent); err != nil {
		return err
	}
	if spec.Model != "" && !modelPattern.MatchString(spec.Model) {
		return fmt.Errorf("%q is not a model name this bay passes to an agent", spec.Model)
	}
	switch spec.Kind {
	case jobKindAgent:
		if !namePattern.MatchString(spec.Project) {
			return fmt.Errorf("the project %q is not a directory name this bay uses", spec.Project)
		}
		if !namePattern.MatchString(spec.Workspace) {
			return fmt.Errorf("the workspace %q is not a directory name this bay uses", spec.Workspace)
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
			return fmt.Errorf("the prompt is %d bytes, over the %d this bay passes to an agent", len(spec.Prompt), maxJobPrompt)
		}
		if strings.ContainsRune(spec.Prompt, 0) {
			return errors.New("the prompt holds a NUL byte")
		}
		if spec.TimeoutSeconds < minJobTimeoutSeconds || spec.TimeoutSeconds > maxJobTimeoutSeconds {
			return fmt.Errorf("timeoutSeconds %d is outside %d to %d", spec.TimeoutSeconds, minJobTimeoutSeconds, maxJobTimeoutSeconds)
		}
	case jobKindCheck:
		// A check asks its fixed question with nothing in reach: no
		// workspace, no key, no MCP server, no prompt of Lore's.
		if spec.Project != "" || spec.Workspace != "" || spec.Key != "" || spec.MCPURL != "" || spec.Prompt != "" {
			return errors.New("a check carries no workspace, key, MCP URL or prompt")
		}
		if spec.TimeoutSeconds < minJobTimeoutSeconds || spec.TimeoutSeconds > maxCheckTimeout {
			return fmt.Errorf("a check's timeoutSeconds %d is outside %d to %d", spec.TimeoutSeconds, minJobTimeoutSeconds, maxCheckTimeout)
		}
	default:
		return fmt.Errorf("unknown job kind %q: this bay runs %s and %s jobs", spec.Kind, jobKindAgent, jobKindCheck)
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

// agentRunOf is the run an adapter builds a spec's command line from.
func agentRunOf(spec jobSpec) agentRun {
	if spec.Kind == jobKindCheck {
		return agentRun{Prompt: checkPrompt, Model: spec.Model}
	}
	return agentRun{Prompt: spec.Prompt, Model: spec.Model, MCPURL: spec.MCPURL}
}
