package deploy

import (
	"fmt"
	"sort"
	"strings"
	"testing"

	"github.com/alepha/bay/internal/runner"
)

// flatEnv reads an instance .env and renders it back as plain `KEY=value`
// lines, so a test asserts on VALUES rather than on the wire encoding.
//
// The file itself is double-quoted and escaped, because systemd reads it too
// as an EnvironmentFile and its grammar eats backslashes and honours quotes
// (see runner.QuoteEnvValue). Asserting `strings.Contains(raw, "K=V")` against
// that file would pin the encoding in a dozen places that do not care about
// it, and would have to change again the next time it does. The encoding is
// pinned once, deliberately, in runner/envfile_test.go.
func flatEnv(t *testing.T, path string) string {
	t.Helper()
	values, err := runner.LoadEnvFile(path)
	if err != nil {
		t.Fatal(err)
	}
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var b strings.Builder
	for _, k := range keys {
		fmt.Fprintf(&b, "%s=%s\n", k, values[k])
	}
	return b.String()
}
