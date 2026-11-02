// Package s3test is an in-memory S3 bucket for tests.
//
// It speaks the slice of the protocol the s3 client uses (path-style PUT, GET,
// HEAD, DELETE, ListObjectsV2 and multipart uploads) and nothing more. It does not verify signatures:
// that is pinned against AWS's own published vectors in the s3 package, which
// proves more than a server sharing the client's signing code ever could.
package s3test

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/xml"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/s3"
)

// Server is one bucket behind an httptest server.
type Server struct {
	URL    string
	Bucket string

	// PageSize caps how many keys one listing returns, so pagination can be
	// exercised with a handful of objects. Zero means 1000, as on S3.
	PageSize int

	// PartSize is handed to clients from Client, so multipart uploads can be
	// exercised with a few bytes. Zero leaves the client's default.
	PartSize int64

	// Fail, when set, is consulted before every request; a non-zero status is
	// returned as is, with an S3-style error body.
	Fail func(r *http.Request) int

	mu      sync.Mutex
	objects map[string][]byte
	// uploads holds multipart uploads in progress: id → key and parts.
	uploads map[string]*upload
	uploadN int
	// Requests counts what reached the bucket, by method, for tests that
	// assert something was NOT done.
	requests map[string]int
}

// New starts a server closed with the test.
func New(t testing.TB) *Server {
	t.Helper()
	s := &Server{Bucket: "bucket", objects: map[string][]byte{}, requests: map[string]int{}, uploads: map[string]*upload{}}
	ts := httptest.NewServer(http.HandlerFunc(s.serve))
	t.Cleanup(ts.Close)
	s.URL = ts.URL
	return s
}

// Client returns an s3 client pointed at this bucket.
func (s *Server) Client(t testing.TB) *s3.Client {
	t.Helper()
	c, err := s3.New(s3.Config{Endpoint: s.URL, Bucket: s.Bucket, AccessKey: "AK", SecretKey: "SK", PartSize: s.PartSize})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// Seed writes an object directly, bypassing the client.
func (s *Server) Seed(key string, body []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.objects[key] = body
}

// Object returns a stored object, bypassing the client.
func (s *Server) Object(key string) ([]byte, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.objects[key]
	return b, ok
}

// Keys returns every stored key, sorted.
func (s *Server) Keys() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	keys := make([]string, 0, len(s.objects))
	for k := range s.objects {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// PendingUploads returns how many multipart uploads were started and neither
// completed nor aborted: each one is storage a provider bills and no listing shows.
func (s *Server) PendingUploads() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.uploads)
}

// Requests returns how many requests of a method reached the bucket.
func (s *Server) Requests(method string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.requests[method]
}

func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	s.requests[r.Method]++
	s.mu.Unlock()

	if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=AK/") {
		writeError(w, http.StatusForbidden, "AccessDenied")
		return
	}
	if s.Fail != nil {
		if code := s.Fail(r); code != 0 {
			writeError(w, code, "InjectedFailure")
			return
		}
	}

	prefix := "/" + s.Bucket
	if r.URL.Path != prefix && !strings.HasPrefix(r.URL.Path, prefix+"/") {
		writeError(w, http.StatusNotFound, "NoSuchBucket")
		return
	}
	key := strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, prefix), "/")

	s.mu.Lock()
	defer s.mu.Unlock()
	q := r.URL.Query()
	switch {
	case key != "" && (q.Has("uploads") || q.Has("uploadId")):
		s.multipart(w, r, key)
	case r.Method == http.MethodGet && key == "":
		s.list(w, r)
	case r.Method == http.MethodPut:
		body, err := io.ReadAll(r.Body)
		if err != nil {
			writeError(w, http.StatusBadRequest, "IncompleteBody")
			return
		}
		s.objects[key] = body
		w.Header().Set("ETag", etag(body))
		w.WriteHeader(http.StatusOK)
	case r.Method == http.MethodHead:
		body, ok := s.objects[key]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(body)))
		w.WriteHeader(http.StatusOK)
	case r.Method == http.MethodGet:
		body, ok := s.objects[key]
		if !ok {
			writeError(w, http.StatusNotFound, "NoSuchKey")
			return
		}
		_, _ = w.Write(body)
	case r.Method == http.MethodDelete:
		// S3 answers 204 whether or not the key existed.
		delete(s.objects, key)
		w.WriteHeader(http.StatusNoContent)
	default:
		writeError(w, http.StatusMethodNotAllowed, "MethodNotAllowed")
	}
}

func (s *Server) list(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if q.Get("list-type") != "2" {
		writeError(w, http.StatusBadRequest, "UnsupportedListType")
		return
	}
	prefix := q.Get("prefix")
	var keys []string
	for k := range s.objects {
		if strings.HasPrefix(k, prefix) {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)

	start := 0
	if token := q.Get("continuation-token"); token != "" {
		n, err := strconv.Atoi(token)
		if err != nil {
			writeError(w, http.StatusBadRequest, "InvalidToken")
			return
		}
		start = n
	}
	page := s.PageSize
	if page <= 0 {
		page = 1000
	}
	end := min(start+page, len(keys))

	type content struct {
		Key          string
		Size         int64
		LastModified string
	}
	type result struct {
		XMLName               xml.Name `xml:"ListBucketResult"`
		IsTruncated           bool
		NextContinuationToken string `xml:",omitempty"`
		Contents              []content
	}
	out := result{IsTruncated: end < len(keys)}
	if out.IsTruncated {
		out.NextContinuationToken = strconv.Itoa(end)
	}
	stamp := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC).Format(time.RFC3339)
	for _, k := range keys[start:end] {
		out.Contents = append(out.Contents, content{Key: k, Size: int64(len(s.objects[k])), LastModified: stamp})
	}
	w.Header().Set("Content-Type", "application/xml")
	_ = xml.NewEncoder(w).Encode(out)
}

type upload struct {
	key   string
	parts map[int][]byte
}

func etag(body []byte) string {
	sum := md5.Sum(body)
	return `"` + hex.EncodeToString(sum[:]) + `"`
}

// multipart handles Create (POST ?uploads), UploadPart (PUT ?partNumber&uploadId),
// Complete (POST ?uploadId) and Abort (DELETE ?uploadId). The caller holds s.mu.
func (s *Server) multipart(w http.ResponseWriter, r *http.Request, key string) {
	q := r.URL.Query()
	if r.Method == http.MethodPost && q.Has("uploads") {
		s.uploadN++
		id := "upload-" + strconv.Itoa(s.uploadN)
		s.uploads[id] = &upload{key: key, parts: map[int][]byte{}}
		w.Header().Set("Content-Type", "application/xml")
		_, _ = io.WriteString(w, "<InitiateMultipartUploadResult><Key>"+key+"</Key><UploadId>"+id+"</UploadId></InitiateMultipartUploadResult>")
		return
	}
	up, ok := s.uploads[q.Get("uploadId")]
	if !ok || up.key != key {
		writeError(w, http.StatusNotFound, "NoSuchUpload")
		return
	}
	switch r.Method {
	case http.MethodPut:
		n, err := strconv.Atoi(q.Get("partNumber"))
		if err != nil || n < 1 || n > 10000 {
			writeError(w, http.StatusBadRequest, "InvalidPartNumber")
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			writeError(w, http.StatusBadRequest, "IncompleteBody")
			return
		}
		up.parts[n] = body
		w.Header().Set("ETag", etag(body))
		w.WriteHeader(http.StatusOK)
	case http.MethodPost:
		var req struct {
			Parts []struct {
				PartNumber int
				ETag       string
			} `xml:"Part"`
		}
		if err := xml.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Parts) == 0 {
			writeError(w, http.StatusBadRequest, "MalformedXML")
			return
		}
		var whole []byte
		for i, p := range req.Parts {
			body, ok := up.parts[p.PartNumber]
			if !ok || p.PartNumber != i+1 || etag(body) != p.ETag {
				writeError(w, http.StatusBadRequest, "InvalidPart")
				return
			}
			whole = append(whole, body...)
		}
		s.objects[key] = whole
		delete(s.uploads, q.Get("uploadId"))
		_, _ = io.WriteString(w, "<CompleteMultipartUploadResult><Key>"+key+"</Key></CompleteMultipartUploadResult>")
	case http.MethodDelete:
		delete(s.uploads, q.Get("uploadId"))
		w.WriteHeader(http.StatusNoContent)
	default:
		writeError(w, http.StatusMethodNotAllowed, "MethodNotAllowed")
	}
}

func writeError(w http.ResponseWriter, code int, s3Code string) {
	w.Header().Set("Content-Type", "application/xml")
	w.WriteHeader(code)
	_, _ = io.WriteString(w, "<Error><Code>"+s3Code+"</Code></Error>")
}
