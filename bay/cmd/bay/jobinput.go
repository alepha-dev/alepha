package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"sync"
)

/*
A running agent job's stdin (#Q4456): what lets a member poke a job.

An adapter with Messages runs its CLI reading user messages as stream-json
lines on stdin: the prompt is the first line, and the stdin stays open so a
`job-message` can write another while the job runs. Claude Code reads one
between two tool calls, or starts a new turn with it when it sits idle
waiting on a background task.

A job nobody pokes must still end as it does with `-p <prompt>`: the stdin
is closed once a `result` line arrived and the last `background_tasks_changed`
listed no task (or none was ever listed). With a task still running, the CLI
waits for it, takes its last turn on its notification, and that turn's
result closes it. Once closed, a message is refused: the job is finishing.
*/
type jobInput struct {
	// mu guards the pipe and whether it is closed; wmu orders the writes on
	// it, the prompt first. A write is never made under mu, so closing the
	// input never waits on an agent that is not reading.
	mu     sync.Mutex
	w      io.WriteCloser
	closed bool
	wmu    sync.Mutex
}

var (
	errJobInputNone   = errors.New("this job takes no messages: its agent CLI reads none while it runs")
	errJobInputClosed = errors.New("the job is finishing: its agent has ended its last turn and reads no more messages")
)

// userLine is a stream-json user message, one line.
func userLine(text string) []byte {
	raw, _ := json.Marshal(map[string]any{
		"type":    "user",
		"message": map[string]any{"role": "user", "content": text},
	})
	return append(raw, '\n')
}

/*
open hands the input its pipe, at once, and writes the prompt as the first
message in the background: a prompt past the pipe's buffer waits on the
agent reading it. A message sent meanwhile waits for the prompt, never goes
before it.
*/
func (in *jobInput) open(w io.WriteCloser, prompt string) {
	in.mu.Lock()
	in.w = w
	in.mu.Unlock()
	in.wmu.Lock()
	go func() {
		defer in.wmu.Unlock()
		_, _ = w.Write(userLine(prompt))
	}()
}

// send writes one user message to the running agent.
func (in *jobInput) send(text string) error {
	if in == nil {
		return errJobInputNone
	}
	in.mu.Lock()
	w, closed := in.w, in.closed
	in.mu.Unlock()
	if w == nil {
		return errJobInputNone
	}
	if closed {
		return errJobInputClosed
	}
	in.wmu.Lock()
	defer in.wmu.Unlock()
	if _, err := w.Write(userLine(text)); err != nil {
		return errJobInputClosed
	}
	return nil
}

// close ends the agent's input, once. A write blocked on it fails.
func (in *jobInput) close() {
	in.mu.Lock()
	defer in.mu.Unlock()
	if in.w != nil && !in.closed {
		_ = in.w.Close()
	}
	in.closed = true
}

/*
inputCloser reads the agent's stdout lines, untouched, and closes its input
when a turn ended with no background task left. Lines past maxResultLine are
skipped: a result or a task list is never that long.
*/
type inputCloser struct {
	mu      sync.Mutex
	in      *jobInput
	partial []byte
	skip    bool
	// tasks is how many background tasks the last list held.
	tasks int
	// idle is a turn ended (a result) with no user line read since: a task
	// list going empty then closes the input, as no turn may follow.
	idle bool
}

func (c *inputCloser) Write(p []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	rest := p
	for len(rest) > 0 {
		i := bytes.IndexByte(rest, '\n')
		if i < 0 {
			c.hold(rest)
			break
		}
		c.hold(rest[:i])
		if !c.skip {
			c.line(c.partial)
		}
		c.partial, c.skip = c.partial[:0], false
		rest = rest[i+1:]
	}
	return len(p), nil
}

func (c *inputCloser) hold(b []byte) {
	if c.skip {
		return
	}
	if len(c.partial)+len(b) > maxResultLine {
		c.partial, c.skip = c.partial[:0], true
		return
	}
	c.partial = append(c.partial, b...)
}

func (c *inputCloser) line(raw []byte) {
	var event struct {
		Type    string            `json:"type"`
		Subtype string            `json:"subtype"`
		Tasks   []json.RawMessage `json:"tasks"`
	}
	if json.Unmarshal(raw, &event) != nil {
		return
	}
	switch {
	case event.Type == "system" && event.Subtype == "background_tasks_changed":
		c.tasks = len(event.Tasks)
		if c.tasks == 0 && c.idle {
			c.in.close()
		}
	case event.Type == "user":
		// A message read, or a tool's result: a turn is running.
		c.idle = false
	case event.Type == "result":
		c.idle = true
		if c.tasks == 0 {
			c.in.close()
		}
	}
}
