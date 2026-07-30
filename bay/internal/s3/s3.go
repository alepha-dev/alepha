// Package s3 is a minimal S3 client: put, get, list, delete.
//
// Hand-rolled SigV4 rather than the AWS SDK. Bay needs four operations, and the
// SDK would add tens of megabytes and a large dependency tree to a binary whose
// whole point is being small enough to forget about. Signing is ~100 lines and
// fully specified; correctness is proved against a real endpoint, which is a
// better test than any mock.
package s3

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// Config points the client at a bucket.
type Config struct {
	Endpoint  string // e.g. https://<account>.r2.cloudflarestorage.com
	Bucket    string
	AccessKey string
	SecretKey string
	Region    string // "auto" for R2
}

// Client talks to one bucket.
type Client struct {
	cfg  Config
	http *http.Client
}

func New(cfg Config) (*Client, error) {
	if cfg.Endpoint == "" || cfg.Bucket == "" || cfg.AccessKey == "" || cfg.SecretKey == "" {
		return nil, fmt.Errorf("s3: endpoint, bucket, accessKey and secretKey are all required")
	}
	if cfg.Region == "" {
		cfg.Region = "auto"
	}
	cfg.Endpoint = strings.TrimRight(cfg.Endpoint, "/")
	return &Client{cfg: cfg, http: &http.Client{Timeout: 10 * time.Minute}}, nil
}

// Object is one entry of a listing.
type Object struct {
	Key          string
	Size         int64
	LastModified time.Time
}

// Put uploads bytes at key.
func (c *Client) Put(ctx context.Context, key string, body []byte) error {
	res, err := c.do(ctx, http.MethodPut, key, nil, body)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	return expect(res, http.StatusOK)
}

// Get downloads the object at key.
func (c *Client) Get(ctx context.Context, key string) ([]byte, error) {
	res, err := c.do(ctx, http.MethodGet, key, nil, nil)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if err := expect(res, http.StatusOK); err != nil {
		return nil, err
	}
	return io.ReadAll(res.Body)
}

// Delete removes the object at key. Deleting a missing key is not an error,
// which keeps retention idempotent.
func (c *Client) Delete(ctx context.Context, key string) error {
	res, err := c.do(ctx, http.MethodDelete, key, nil, nil)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	return expect(res, http.StatusNoContent, http.StatusOK, http.StatusNotFound)
}

// List returns every object under prefix, following continuation tokens.
//
// Listing rather than keeping a "latest" pointer: a pointer can go stale or be
// written without its target, and then a restore silently reaches for something
// that is not there. The listing is the truth.
func (c *Client) List(ctx context.Context, prefix string) ([]Object, error) {
	var out []Object
	token := ""
	for {
		q := url.Values{}
		q.Set("list-type", "2")
		q.Set("prefix", prefix)
		if token != "" {
			q.Set("continuation-token", token)
		}
		res, err := c.do(ctx, http.MethodGet, "", q, nil)
		if err != nil {
			return nil, err
		}
		raw, readErr := io.ReadAll(res.Body)
		res.Body.Close()
		if err := expect(res, http.StatusOK); err != nil {
			return nil, err
		}
		if readErr != nil {
			return nil, readErr
		}

		var parsed struct {
			IsTruncated           bool   `xml:"IsTruncated"`
			NextContinuationToken string `xml:"NextContinuationToken"`
			Contents              []struct {
				Key          string    `xml:"Key"`
				Size         int64     `xml:"Size"`
				LastModified time.Time `xml:"LastModified"`
			} `xml:"Contents"`
		}
		if err := xml.Unmarshal(raw, &parsed); err != nil {
			return nil, fmt.Errorf("s3: parse listing: %w", err)
		}
		for _, o := range parsed.Contents {
			out = append(out, Object{Key: o.Key, Size: o.Size, LastModified: o.LastModified})
		}
		if !parsed.IsTruncated || parsed.NextContinuationToken == "" {
			break
		}
		token = parsed.NextContinuationToken
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out, nil
}

// ---------------------------------------------------------------------------
// request signing
// ---------------------------------------------------------------------------

func (c *Client) do(ctx context.Context, method, key string, query url.Values, body []byte) (*http.Response, error) {
	// Path-style addressing: R2 supports it and it avoids DNS games with
	// bucket names.
	path := "/" + c.cfg.Bucket
	if key != "" {
		path += "/" + strings.TrimPrefix(key, "/")
	}

	endpoint, err := url.Parse(c.cfg.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("s3: bad endpoint: %w", err)
	}
	target := *endpoint
	target.Path = path
	if query != nil {
		target.RawQuery = query.Encode()
	}

	req, err := http.NewRequestWithContext(ctx, method, target.String(), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.ContentLength = int64(len(body))

	c.sign(req, path, query, body)
	return c.http.Do(req)
}

// sign applies AWS Signature Version 4 to the request.
func (c *Client) sign(req *http.Request, path string, query url.Values, body []byte) {
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")

	payloadHash := sha256Hex(body)
	req.Header.Set("Host", req.URL.Host)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	req.Header.Set("X-Amz-Date", amzDate)

	// Only host and the two x-amz headers are signed. Keeping the signed set
	// minimal and explicit avoids the classic failure where a transport adds a
	// header after signing and the signature no longer matches.
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"
	canonicalHeaders := strings.Join([]string{
		"host:" + req.URL.Host,
		"x-amz-content-sha256:" + payloadHash,
		"x-amz-date:" + amzDate,
	}, "\n") + "\n"

	canonicalQuery := ""
	if query != nil {
		canonicalQuery = canonicalizeQuery(query)
	}

	canonicalRequest := strings.Join([]string{
		req.Method,
		canonicalURI(path),
		canonicalQuery,
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	}, "\n")

	scope := strings.Join([]string{dateStamp, c.cfg.Region, "s3", "aws4_request"}, "/")
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		scope,
		sha256Hex([]byte(canonicalRequest)),
	}, "\n")

	key := hmacSHA256([]byte("AWS4"+c.cfg.SecretKey), dateStamp)
	key = hmacSHA256(key, c.cfg.Region)
	key = hmacSHA256(key, "s3")
	key = hmacSHA256(key, "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(key, stringToSign))

	req.Header.Set("Authorization", fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		c.cfg.AccessKey, scope, signedHeaders, signature,
	))
}

// canonicalURI percent-encodes each path segment while preserving separators.
func canonicalURI(path string) string {
	segments := strings.Split(path, "/")
	for i, s := range segments {
		segments[i] = uriEncode(s)
	}
	return strings.Join(segments, "/")
}

// canonicalizeQuery sorts and encodes query parameters the way SigV4 requires,
// which is NOT what url.Values.Encode produces for every character.
func canonicalizeQuery(q url.Values) string {
	keys := make([]string, 0, len(q))
	for k := range q {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		values := append([]string(nil), q[k]...)
		sort.Strings(values)
		for _, v := range values {
			parts = append(parts, uriEncode(k)+"="+uriEncode(v))
		}
	}
	return strings.Join(parts, "&")
}

// uriEncode implements the AWS variant of RFC 3986: unreserved characters pass
// through, everything else is percent-encoded uppercase. Notably a space must
// become %20 and never +, which is where url.QueryEscape gets it wrong.
func uriEncode(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		ch := s[i]
		switch {
		case ch >= 'A' && ch <= 'Z', ch >= 'a' && ch <= 'z', ch >= '0' && ch <= '9',
			ch == '-', ch == '_', ch == '.', ch == '~':
			b.WriteByte(ch)
		default:
			fmt.Fprintf(&b, "%%%02X", ch)
		}
	}
	return b.String()
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func hmacSHA256(key []byte, data string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(data))
	return h.Sum(nil)
}

func expect(res *http.Response, codes ...int) error {
	for _, c := range codes {
		if res.StatusCode == c {
			return nil
		}
	}
	body, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
	return fmt.Errorf("s3: %s: %s", res.Status, strings.TrimSpace(string(body)))
}
