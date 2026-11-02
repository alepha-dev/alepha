package s3_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/alepha-dev/bay/internal/s3"
	"github.com/alepha-dev/bay/internal/s3/s3test"
)

func writeTemp(t *testing.T, body []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// payload is not a repeat of one byte, so a part sent twice or out of order
// shows in the stored object.
func payload(n int) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(i*7 + i/251)
	}
	return b
}

func TestPutFileUnderOnePartIsASinglePut(t *testing.T) {
	srv := s3test.New(t)
	srv.PartSize = 64
	body := payload(64)

	size, err := srv.Client(t).PutFile(context.Background(), "k", writeTemp(t, body))
	if err != nil || size != 64 {
		t.Fatalf("PutFile = %d, %v", size, err)
	}
	if got, _ := srv.Object("k"); !bytes.Equal(got, body) {
		t.Fatal("stored object differs from the file")
	}
	if srv.Requests(http.MethodPost) != 0 {
		t.Fatal("a file within one part must not start a multipart upload")
	}
}

func TestPutFileOverOnePartGoesUpInParts(t *testing.T) {
	srv := s3test.New(t)
	srv.PartSize = 10
	body := payload(35) // 10 + 10 + 10 + 5

	size, err := srv.Client(t).PutFile(context.Background(), "apps/a/db/x.gz", writeTemp(t, body))
	if err != nil || size != 35 {
		t.Fatalf("PutFile = %d, %v", size, err)
	}
	if got, _ := srv.Object("apps/a/db/x.gz"); !bytes.Equal(got, body) {
		t.Fatalf("parts were not reassembled in order: got %d bytes", len(got))
	}
	if srv.Requests(http.MethodPut) != 4 {
		t.Fatalf("want 4 part uploads, got %d", srv.Requests(http.MethodPut))
	}
	if srv.PendingUploads() != 0 {
		t.Fatal("a completed upload must not stay pending")
	}
}

func TestPutFileRetriesAPartThatFailed(t *testing.T) {
	srv := s3test.New(t)
	srv.PartSize = 10
	var failed atomic.Bool
	srv.Fail = func(r *http.Request) int {
		if r.Method == http.MethodPut && r.URL.Query().Get("partNumber") == "2" && failed.CompareAndSwap(false, true) {
			return http.StatusInternalServerError
		}
		return 0
	}
	body := payload(25)
	if _, err := srv.Client(t).PutFile(context.Background(), "k", writeTemp(t, body)); err != nil {
		t.Fatalf("one failed part must be retried, not fail the upload: %v", err)
	}
	if got, _ := srv.Object("k"); !bytes.Equal(got, body) {
		t.Fatal("stored object differs from the file")
	}
}

func TestPutFileAbortsAnUploadThatCannotFinish(t *testing.T) {
	srv := s3test.New(t)
	srv.PartSize = 10
	srv.Fail = func(r *http.Request) int {
		if r.Method == http.MethodPut && r.URL.Query().Get("partNumber") == "3" {
			return http.StatusInternalServerError
		}
		return 0
	}
	_, err := srv.Client(t).PutFile(context.Background(), "k", writeTemp(t, payload(35)))
	if err == nil || !strings.Contains(err.Error(), "part 3") {
		t.Fatalf("want an error naming part 3, got %v", err)
	}
	if srv.PendingUploads() != 0 {
		t.Fatal("a failed multipart upload must be aborted: its parts are billed and never listed")
	}
	if _, ok := srv.Object("k"); ok {
		t.Fatal("a failed upload must not leave an object")
	}
}

func TestPutFileDoesNotRetryARefusal(t *testing.T) {
	srv := s3test.New(t)
	srv.PartSize = 10
	var parts atomic.Int32
	srv.Fail = func(r *http.Request) int {
		if r.Method == http.MethodPut {
			parts.Add(1)
			return http.StatusForbidden
		}
		return 0
	}
	if _, err := srv.Client(t).PutFile(context.Background(), "k", writeTemp(t, payload(25))); !s3.IsDenied(err) {
		t.Fatalf("want the refusal surfaced, got %v", err)
	}
	if parts.Load() != 1 {
		t.Fatalf("a denied part is not transient, want 1 attempt, got %d", parts.Load())
	}
}

func TestPutFileChecksTheStoredSize(t *testing.T) {
	// A bucket that accepts the PUT but reports another size: whatever the
	// cause, the upload is not done.
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			w.Header().Set("Content-Length", "3")
		}
		_, _ = io.Copy(io.Discard, r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(ts.Close)
	c, err := s3.New(s3.Config{Endpoint: ts.URL, Bucket: "b", AccessKey: "a", SecretKey: "s"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.PutFile(context.Background(), "k", writeTemp(t, payload(8))); err == nil || !strings.Contains(err.Error(), "8 were sent") {
		t.Fatalf("want a size mismatch error, got %v", err)
	}
}

func TestHeadAndOpenStreamTheObject(t *testing.T) {
	srv := s3test.New(t)
	body := payload(1000)
	srv.Seed("k", body)
	c := srv.Client(t)
	ctx := context.Background()

	obj, err := c.Head(ctx, "k")
	if err != nil || obj.Size != 1000 {
		t.Fatalf("Head = %+v, %v", obj, err)
	}
	r, size, err := c.Open(ctx, "k")
	if err != nil || size != 1000 {
		t.Fatalf("Open = %d, %v", size, err)
	}
	defer r.Close()
	got, err := io.ReadAll(r)
	if err != nil || !bytes.Equal(got, body) {
		t.Fatalf("read %d bytes, %v", len(got), err)
	}

	if _, _, err := c.Open(ctx, "missing"); err == nil {
		t.Fatal("opening a missing key must fail")
	}
	if _, err := c.Head(ctx, "missing"); err == nil {
		t.Fatal("Head of a missing key must fail")
	}
}

func TestOpenReportsACutDownload(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "100")
		_, _ = w.Write([]byte("only forty bytes of the hundred promised"))
		// Hijack and close: the client sees the connection end early.
		conn, _, err := w.(http.Hijacker).Hijack()
		if err == nil {
			conn.Close()
		}
	}))
	t.Cleanup(ts.Close)
	c, err := s3.New(s3.Config{Endpoint: ts.URL, Bucket: "b", AccessKey: "a", SecretKey: "s"})
	if err != nil {
		t.Fatal(err)
	}
	r, _, err := c.Open(context.Background(), "k")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if _, err := io.ReadAll(r); !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("a short body must read as an error, got %v", err)
	}
}
