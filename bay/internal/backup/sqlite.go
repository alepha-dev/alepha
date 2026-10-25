package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// sqliteHelper is run by the app's OWN runtime.
//
// Bay is built without cgo and ships no SQLite driver — and it should not. Using
// the runtime that wrote the database guarantees the same SQLite version reads
// it, and keeps Bay's promise of not knowing what SQL is.
//
// `VACUUM INTO` is used rather than copying the file: it is transactionally safe
// on a live database, whereas `cp` of a database with an active WAL yields a
// corrupt snapshot that only reveals itself at restore time.
const sqliteHelper = `
const { DatabaseSync } = require("node:sqlite");
// argv is [execPath, scriptPath, ...args] for a script file. Getting this wrong
// once pointed a VACUUM target at the live database.
const [cmd, a, b] = process.argv.slice(2);
const quote = (p) => "'" + String(p).replace(/'/g, "''") + "'";

function inspect(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
  const tables = db.prepare(
    "SELECT count(*) c FROM sqlite_master WHERE type='table'"
  ).get().c;
  db.close();
  return { integrity, tables };
}

if (cmd === "snapshot") {
  if (!a || !b) { console.error("snapshot needs <src> <dest>"); process.exit(2); }
  const db = new DatabaseSync(a, { readOnly: true });
  db.exec("VACUUM INTO " + quote(b));
  db.close();
  console.log(JSON.stringify(inspect(b)));
} else if (cmd === "verify") {
  if (!a) { console.error("verify needs <db>"); process.exit(2); }
  console.log(JSON.stringify(inspect(a)));
} else {
  console.error("unknown command: " + cmd);
  process.exit(2);
}
`

// Inspection is what the helper reports back about a database file.
type Inspection struct {
	Integrity string `json:"integrity"`
	Tables    int    `json:"tables"`
}

// OK reports whether SQLite considers the file sound.
func (i Inspection) OK() bool { return i.Integrity == "ok" }

/*
Interpreter runs the helper script with the app's own runtime.

Two shapes: a runtime binary on this host (HostRuntime), and the app's runtime
image, which is what Bay uses since apps run in containers (epic E73). Either
way the runtime that reads the database is the one that wrote it.
*/
type Interpreter interface {
	// Run executes `script` (JavaScript source) with `args` and answers its
	// stdout. Every path in args is absolute.
	Run(ctx context.Context, script string, args ...string) ([]byte, error)
}

// HostRuntime is a runtime binary on this host, e.g. a `node` with
// node:sqlite.
type HostRuntime string

// Run writes the script to a temp file and runs it with the binary.
func (h HostRuntime) Run(ctx context.Context, script string, args ...string) ([]byte, error) {
	file, err := os.CreateTemp("", "bay-sqlite-*.js")
	if err != nil {
		return nil, err
	}
	defer os.Remove(file.Name())
	if _, err := file.WriteString(script); err != nil {
		file.Close()
		return nil, err
	}
	if err := file.Close(); err != nil {
		return nil, err
	}
	raw, err := exec.CommandContext(ctx, string(h), append([]string{file.Name()}, args...)...).Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			return raw, fmt.Errorf("%w: %s", err, strings.TrimSpace(string(ee.Stderr)))
		}
		return raw, err
	}
	return raw, nil
}

// sqlite runs the helper with the given arguments.
func sqlite(ctx context.Context, in Interpreter, args ...string) (Inspection, error) {
	var out Inspection
	raw, err := in.Run(ctx, sqliteHelper, args...)
	if err != nil {
		return out, fmt.Errorf("sqlite helper %v: %w", args, err)
	}
	if err := json.Unmarshal([]byte(lastLine(raw)), &out); err != nil {
		return out, fmt.Errorf("sqlite helper returned unparseable output %q: %w", raw, err)
	}
	return out, nil
}

// Snapshot writes a consistent copy of src at dest and verifies it.
//
// Verification happens here rather than at restore time on purpose: a snapshot
// that is already corrupt must never reach the bucket, because a bucket full of
// unusable backups looks exactly like a bucket full of good ones.
func Snapshot(ctx context.Context, runtime Interpreter, src, dest string) (Inspection, error) {
	srcAbs, err := filepath.Abs(src)
	if err != nil {
		return Inspection{}, err
	}
	destAbs, err := filepath.Abs(dest)
	if err != nil {
		return Inspection{}, err
	}
	// Refusing this explicitly because it nearly happened: an off-by-one in
	// argument handling aimed the VACUUM target at the live database.
	if srcAbs == destAbs {
		return Inspection{}, fmt.Errorf("snapshot source and destination are the same file: %s", srcAbs)
	}
	if _, err := os.Stat(destAbs); err == nil {
		return Inspection{}, fmt.Errorf("snapshot destination already exists: %s", destAbs)
	}

	got, err := sqlite(ctx, runtime, "snapshot", srcAbs, destAbs)
	if err != nil {
		return got, err
	}
	if !got.OK() {
		return got, fmt.Errorf("snapshot of %s failed integrity check: %s", src, got.Integrity)
	}
	return got, nil
}

// Verify checks an existing database file.
func Verify(ctx context.Context, runtime Interpreter, path string) (Inspection, error) {
	return sqlite(ctx, runtime, "verify", path)
}

// lastLine returns the final non-empty line, so runtime warnings on stdout do
// not break parsing.
func lastLine(b []byte) string {
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if s := strings.TrimSpace(lines[i]); s != "" {
			return s
		}
	}
	return ""
}
