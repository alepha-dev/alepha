package s3_test

import (
	"bytes"
	"context"
	"io"
	"os"
	"testing"

	"github.com/alepha-dev/bay/internal/s3"
)

/*
TestLiveBucket runs the client against a real S3 endpoint, which no fake can
stand in for: the fake does not check signatures, and multipart calls sign
query strings (`uploads=`, `partNumber`, `uploadId`) the signing vectors do
not cover. Skipped unless BAY_S3_TEST_ENDPOINT, _BUCKET, _ACCESS_KEY and
_SECRET_KEY are set; parts are 5 MiB, the smallest S3 accepts, so the
multipart case costs 11 MiB of traffic.

	docker run -d --rm -p 9000:9000 minio/minio server /data
*/
func TestLiveBucket(t *testing.T) {
	cfg := s3.Config{
		Endpoint:  os.Getenv("BAY_S3_TEST_ENDPOINT"),
		Bucket:    os.Getenv("BAY_S3_TEST_BUCKET"),
		AccessKey: os.Getenv("BAY_S3_TEST_ACCESS_KEY"),
		SecretKey: os.Getenv("BAY_S3_TEST_SECRET_KEY"),
		Region:    os.Getenv("BAY_S3_TEST_REGION"),
		PartSize:  5 << 20,
	}
	if cfg.Endpoint == "" {
		t.Skip("BAY_S3_TEST_ENDPOINT not set")
	}
	c, err := s3.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	for _, tc := range []struct {
		name string
		size int
	}{{"single put", 1000}, {"multipart", 11 << 20}} {
		t.Run(tc.name, func(t *testing.T) {
			key := "bay-live-test/" + tc.name + ".bin"
			body := payload(tc.size)
			t.Cleanup(func() { _ = c.Delete(context.Background(), key) })

			size, err := c.PutFile(ctx, key, writeTemp(t, body))
			if err != nil || size != int64(tc.size) {
				t.Fatalf("PutFile = %d, %v", size, err)
			}
			r, _, err := c.Open(ctx, key)
			if err != nil {
				t.Fatal(err)
			}
			got, err := io.ReadAll(r)
			r.Close()
			if err != nil || !bytes.Equal(got, body) {
				t.Fatalf("read back %d bytes, %v", len(got), err)
			}
		})
	}
}
