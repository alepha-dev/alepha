package s3_test

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/alepha-dev/bay/internal/s3"
	"github.com/alepha-dev/bay/internal/s3/s3test"
)

func TestNewRequiresEveryCredential(t *testing.T) {
	full := s3.Config{Endpoint: "https://e", Bucket: "b", AccessKey: "a", SecretKey: "s"}
	if _, err := s3.New(full); err != nil {
		t.Fatalf("a complete config must be accepted: %v", err)
	}
	for _, blank := range []func(*s3.Config){
		func(c *s3.Config) { c.Endpoint = "" },
		func(c *s3.Config) { c.Bucket = "" },
		func(c *s3.Config) { c.AccessKey = "" },
		func(c *s3.Config) { c.SecretKey = "" },
	} {
		cfg := full
		blank(&cfg)
		if _, err := s3.New(cfg); err == nil {
			t.Fatalf("want an error for %+v", cfg)
		}
	}
}

func TestPutGetDelete(t *testing.T) {
	srv := s3test.New(t)
	c := srv.Client(t)
	ctx := context.Background()

	// A space in the key goes through the canonical-URI encoder on the way in
	// and must land under the same name.
	key := "apps/x/db/with space.gz"
	if err := c.Put(ctx, key, []byte("payload")); err != nil {
		t.Fatal(err)
	}
	if got, ok := srv.Object(key); !ok || string(got) != "payload" {
		t.Fatalf("stored %q (present=%v), keys %v", got, ok, srv.Keys())
	}
	got, err := c.Get(ctx, key)
	if err != nil || string(got) != "payload" {
		t.Fatalf("Get = %q, %v", got, err)
	}

	if err := c.Delete(ctx, key); err != nil {
		t.Fatal(err)
	}
	if _, ok := srv.Object(key); ok {
		t.Fatal("object survived Delete")
	}
	// Retention re-runs after a partial failure, so deleting what is already
	// gone must succeed.
	if err := c.Delete(ctx, key); err != nil {
		t.Fatalf("deleting a missing key must not fail: %v", err)
	}
}

func TestDeleteToleratesNotFound(t *testing.T) {
	srv := s3test.New(t)
	srv.Fail = func(r *http.Request) int {
		if r.Method == http.MethodDelete {
			return http.StatusNotFound
		}
		return 0
	}
	if err := srv.Client(t).Delete(context.Background(), "gone"); err != nil {
		t.Fatalf("a 404 on delete is success for retention: %v", err)
	}
}

func TestGetMissingSurfacesTheS3Error(t *testing.T) {
	srv := s3test.New(t)
	_, err := srv.Client(t).Get(context.Background(), "nope")
	if err == nil || !strings.Contains(err.Error(), "404") || !strings.Contains(err.Error(), "NoSuchKey") {
		t.Fatalf("want the status and S3's own error code, got %v", err)
	}
}

func TestPutFailureIsAnError(t *testing.T) {
	srv := s3test.New(t)
	srv.Fail = func(*http.Request) int { return http.StatusInternalServerError }
	if err := srv.Client(t).Put(context.Background(), "k", []byte("v")); err == nil {
		t.Fatal("a 500 on upload must not read as a stored backup")
	}
}

// Listing is how "latest" is found, so a client that stopped at the first page
// would make restore pick a stale backup once a bucket passes 1000 objects.
func TestListFollowsContinuationTokens(t *testing.T) {
	srv := s3test.New(t)
	srv.PageSize = 2
	for i := range 5 {
		srv.Seed(fmt.Sprintf("p/%d", 4-i), bytes.Repeat([]byte("x"), i+1))
	}
	srv.Seed("other/ignored", nil)

	got, err := srv.Client(t).List(context.Background(), "p/")
	if err != nil {
		t.Fatal(err)
	}
	var keys []string
	for _, o := range got {
		keys = append(keys, o.Key)
	}
	if strings.Join(keys, ",") != "p/0,p/1,p/2,p/3,p/4" {
		t.Fatalf("want every page, sorted and filtered by prefix, got %v", keys)
	}
	if got[0].Size != 5 || got[0].LastModified.IsZero() {
		t.Fatalf("size and mtime must be parsed, got %+v", got[0])
	}
	if n := srv.Requests(http.MethodGet); n != 3 {
		t.Fatalf("5 keys at 2 per page is 3 requests, got %d", n)
	}
}

func TestListErrorStatusIsAnError(t *testing.T) {
	srv := s3test.New(t)
	srv.Fail = func(*http.Request) int { return http.StatusForbidden }
	if _, err := srv.Client(t).List(context.Background(), ""); err == nil {
		t.Fatal("an error status on a listing must not read as an empty bucket")
	}
}
