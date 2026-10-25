package s3

import (
	"net/http"
	"net/url"
	"testing"
	"time"
)

// The signature is checked against the worked examples AWS publishes in its
// SigV4 documentation for S3 ("Signature Calculations for the Authorization
// Header"), rather than against a server: a fake that recomputed the signature
// with this package's own code would agree with any bug in it. These two
// examples sign exactly the header set Bay signs (host, x-amz-content-sha256,
// x-amz-date) with an empty payload, so they pin the canonical request, the
// query canonicalisation, the scope and the key derivation in one assertion.
func TestSignMatchesAWSPublishedVectors(t *testing.T) {
	cases := []struct {
		name  string
		query url.Values
		want  string
	}{
		{
			name:  "GET Bucket (List Objects)",
			query: url.Values{"max-keys": {"2"}, "prefix": {"J"}},
			want:  "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7",
		},
		{
			name:  "GET Bucket Lifecycle (a value-less parameter)",
			query: url.Values{"lifecycle": {""}},
			want:  "fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := &Client{
				cfg: Config{
					AccessKey: "AKIAIOSFODNN7EXAMPLE",
					SecretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
					Region:    "us-east-1",
				},
				now: func() time.Time { return time.Date(2013, 5, 24, 0, 0, 0, 0, time.UTC) },
			}
			req, err := http.NewRequest(http.MethodGet, "https://examplebucket.s3.amazonaws.com/", nil)
			if err != nil {
				t.Fatal(err)
			}
			c.sign(req, "/", tc.query, nil)

			want := "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
				"SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=" + tc.want
			if got := req.Header.Get("Authorization"); got != want {
				t.Fatalf("Authorization:\n got  %s\n want %s", got, want)
			}
			if got := req.Header.Get("X-Amz-Date"); got != "20130524T000000Z" {
				t.Fatalf("X-Amz-Date = %q", got)
			}
		})
	}
}

// uriEncode is where hand-rolled SigV4 usually breaks: url.QueryEscape turns a
// space into "+" and leaves "~" alone only by accident of version. A key with
// a space would then sign one string and send another, and S3 answers 403 with
// nothing pointing at the encoder.
func TestURIEncode(t *testing.T) {
	cases := map[string]string{
		"plain-Key_1.txt~": "plain-Key_1.txt~",
		"a b":              "a%20b",
		"a+b":              "a%2Bb",
		"a/b":              "a%2Fb",
		"é":                "%C3%A9",
		"":                 "",
	}
	for in, want := range cases {
		if got := uriEncode(in); got != want {
			t.Errorf("uriEncode(%q) = %q, want %q", in, got, want)
		}
	}
	if got := canonicalURI("/bucket/dir/a b.gz"); got != "/bucket/dir/a%20b.gz" {
		t.Errorf("canonicalURI keeps separators and encodes segments, got %q", got)
	}
	q := url.Values{"b": {"2", "1"}, "a": {"x y"}}
	if got := canonicalizeQuery(q); got != "a=x%20y&b=1&b=2" {
		t.Errorf("canonicalizeQuery sorts keys and values, got %q", got)
	}
}
