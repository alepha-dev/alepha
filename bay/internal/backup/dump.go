package backup

import (
	"context"
	"fmt"
	"time"
)

// dumpSuffix marks a service dump, next to the SQLite snapshots under the same prefix.
const dumpSuffix = ".dump.gz"

/*
Dumper is a stack service's backup hook: it produces a dump and can say
whether one is sound.

The service's own tools do both, inside its own container (`pg_dump`, then
`pg_restore --list`), for the same reason the SQLite helper runs in the app's
runtime: the tool that reads the data is the one that matches the server.
*/
type Dumper interface {
	Dump(ctx context.Context) ([]byte, error)
	// Verify refuses a dump that could not be restored. A hook with no way to
	// check its output verifies only that there is some.
	Verify(ctx context.Context, dump []byte) error
}

/*
BackupDump takes a service dump through the same path as a SQLite snapshot:
verified before it leaves the host, compressed, uploaded under the instance's
prefix. An empty dump is a failure, never an upload: a hook that wrote
nothing looks exactly like a database with nothing in it.

⚠️ The dump is held in memory, as the snapshot is: the S3 client signs whole
bodies. Fine for the databases a small VPS runs; a dump of many gigabytes
needs a streaming upload first.
*/
func (m *Manager) BackupDump(ctx context.Context, app, env string, d Dumper) (*Result, error) {
	raw, err := d.Dump(ctx)
	if err != nil {
		return nil, fmt.Errorf("dump: %w", err)
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("dump: the hook wrote nothing to stdout")
	}
	if err := d.Verify(ctx, raw); err != nil {
		return nil, fmt.Errorf("verify: %w", err)
	}
	packed, err := gzipBytes(raw)
	if err != nil {
		return nil, err
	}
	key := dbPrefix(app, env) + time.Now().UTC().Format(timeLayout) + dumpSuffix
	if err := m.store.Put(ctx, key, packed); err != nil {
		return nil, fmt.Errorf("upload %s: %w", key, err)
	}
	return &Result{Key: key, RawBytes: int64(len(raw)), StoredBytes: int64(len(packed))}, nil
}

// FetchDump downloads a dump, decompresses it and verifies it with the hook.
func (m *Manager) FetchDump(ctx context.Context, key string, d Dumper) ([]byte, error) {
	packed, err := m.store.Get(ctx, key)
	if err != nil {
		return nil, fmt.Errorf("download %s: %w", key, err)
	}
	raw, err := gunzipBytes(packed)
	if err != nil {
		return nil, fmt.Errorf("decompress %s: %w", key, err)
	}
	if err := d.Verify(ctx, raw); err != nil {
		return nil, fmt.Errorf("verify %s: %w", key, err)
	}
	return raw, nil
}
