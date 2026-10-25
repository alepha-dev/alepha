package stack

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os/exec"
	"strings"
)

/*
Exec runs argv inside a running container, with stdin when given, and answers
its stdout. Used by backup hooks, which run in the service's own container so
the dump tool is the one that matches the server.

Through the docker CLI, like Compose: the hooks are already a shell command
the stack's author wrote, and the CLI is what the author tested it with.
*/
func Exec(ctx context.Context, container string, stdin io.Reader, argv ...string) ([]byte, error) {
	args := []string{"exec"}
	if stdin != nil {
		args = append(args, "-i")
	}
	args = append(append(args, container), argv...)
	cmd := exec.CommandContext(ctx, ComposeCommand, args...)
	cmd.Stdin = stdin
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		return stdout.Bytes(), fmt.Errorf("%s in %s: %w: %s", strings.Join(argv, " "), container, err, strings.TrimSpace(stderr.String()))
	}
	return stdout.Bytes(), nil
}
