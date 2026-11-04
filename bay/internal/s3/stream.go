package s3

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// partAttempts is how many times one part is sent before the upload gives up.
// A part is small, so retrying it is cheap; retrying the whole file is not.
const partAttempts = 3

/*
PutFile uploads the file at path to key without holding it in memory.

A file up to PartSize goes in one PUT; a larger one as a multipart upload of
PartSize parts, so memory stays flat whatever the database weighs and a
network hiccup costs one part, not the whole upload. Either way the body is
read twice (once to hash it for the signature, once to send it), which is
the price of signing the payload rather than sending it unsigned.

The object is then checked with HEAD: an upload is only done when the bucket
reports the size that was sent. Returns that size.
*/
func (c *Client) PutFile(ctx context.Context, key, path string) (int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return 0, err
	}
	size := info.Size()

	if size <= c.cfg.PartSize {
		if _, err := c.putPart(ctx, key, nil, io.NewSectionReader(f, 0, size)); err != nil {
			return 0, err
		}
	} else if err := c.multipart(ctx, key, f, size); err != nil {
		return 0, err
	}

	stored, err := c.Head(ctx, key)
	if err != nil {
		return 0, fmt.Errorf("s3: check %s after upload: %w", key, err)
	}
	if stored.Size != size {
		return 0, fmt.Errorf("s3: %s is %d bytes in the bucket, %d were sent", key, stored.Size, size)
	}
	return size, nil
}

// putPart sends one section of a file as a PUT, returning the ETag.
func (c *Client) putPart(ctx context.Context, key string, query url.Values, section *io.SectionReader) (string, error) {
	h := sha256.New()
	if _, err := io.Copy(h, section); err != nil {
		return "", err
	}
	if _, err := section.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	res, err := c.send(ctx, c.http, http.MethodPut, key, query, section, section.Size(), hex.EncodeToString(h.Sum(nil)))
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if err := expect(res, http.StatusOK); err != nil {
		return "", err
	}
	_, _ = io.Copy(io.Discard, res.Body)
	return res.Header.Get("ETag"), nil
}

/*
multipart runs Create → UploadPart × n → Complete, and aborts on any failure.

An abandoned multipart upload is invisible in listings yet billed on most
providers, and stays until a lifecycle rule clears it: the abort is not
optional tidiness. It runs on a fresh context so a cancelled backup still
cleans up after itself.
*/
func (c *Client) multipart(ctx context.Context, key string, f *os.File, size int64) (err error) {
	uploadID, err := c.createMultipart(ctx, key)
	if err != nil {
		return err
	}
	defer func() {
		if err == nil {
			return
		}
		abortCtx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		if abortErr := c.abortMultipart(abortCtx, key, uploadID); abortErr != nil {
			err = fmt.Errorf("%w (and the abort failed too, the parts stay until a lifecycle rule clears them: %v)", err, abortErr)
		}
	}()

	type part struct {
		XMLName    xml.Name `xml:"Part"`
		PartNumber int      `xml:"PartNumber"`
		ETag       string   `xml:"ETag"`
	}
	var parts []part
	for n, offset := 1, int64(0); offset < size; n, offset = n+1, offset+c.cfg.PartSize {
		length := min(c.cfg.PartSize, size-offset)
		query := url.Values{"partNumber": {strconv.Itoa(n)}, "uploadId": {uploadID}}
		var etag string
		for attempt := 1; ; attempt++ {
			etag, err = c.putPart(ctx, key, query, io.NewSectionReader(f, offset, length))
			if err == nil || attempt == partAttempts || IsDenied(err) || ctx.Err() != nil {
				break
			}
		}
		if err != nil {
			return fmt.Errorf("s3: upload part %d of %s: %w", n, key, err)
		}
		if etag == "" {
			return fmt.Errorf("s3: part %d of %s came back without an ETag", n, key)
		}
		parts = append(parts, part{PartNumber: n, ETag: etag})
	}

	body, err := xml.Marshal(struct {
		XMLName xml.Name `xml:"CompleteMultipartUpload"`
		Parts   []part
	}{Parts: parts})
	if err != nil {
		return err
	}
	res, err := c.do(ctx, http.MethodPost, key, url.Values{"uploadId": {uploadID}}, body)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if err := expect(res, http.StatusOK); err != nil {
		return err
	}
	// S3 can answer Complete with 200 and an error in the body, when it
	// failed after the response started.
	raw, err := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if err != nil {
		return err
	}
	if bytes.Contains(raw, []byte("<Error>")) {
		return fmt.Errorf("s3: complete %s: %s", key, strings.TrimSpace(string(raw)))
	}
	return nil
}

func (c *Client) createMultipart(ctx context.Context, key string) (string, error) {
	res, err := c.do(ctx, http.MethodPost, key, url.Values{"uploads": {""}}, nil)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if err := expect(res, http.StatusOK); err != nil {
		return "", err
	}
	var parsed struct {
		UploadID string `xml:"UploadId"`
	}
	if err := xml.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&parsed); err != nil {
		return "", fmt.Errorf("s3: parse multipart upload: %w", err)
	}
	if parsed.UploadID == "" {
		return "", errors.New("s3: multipart upload started without an UploadId")
	}
	return parsed.UploadID, nil
}

func (c *Client) abortMultipart(ctx context.Context, key, uploadID string) error {
	res, err := c.do(ctx, http.MethodDelete, key, url.Values{"uploadId": {uploadID}}, nil)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	return expect(res, http.StatusNoContent, http.StatusOK, http.StatusNotFound)
}

// Head returns an object's size without downloading it.
func (c *Client) Head(ctx context.Context, key string) (Object, error) {
	res, err := c.do(ctx, http.MethodHead, key, nil, nil)
	if err != nil {
		return Object{}, err
	}
	defer res.Body.Close()
	if err := expect(res, http.StatusOK); err != nil {
		return Object{}, err
	}
	modified, _ := http.ParseTime(res.Header.Get("Last-Modified"))
	return Object{Key: key, Size: res.ContentLength, LastModified: modified}, nil
}

/*
Open streams the object at key. The caller must read it to the end and close
it; a body that stops short of the announced length reads as an error, never
as a clean end, so a cut connection cannot pass for a smaller object.
*/
func (c *Client) Open(ctx context.Context, key string) (io.ReadCloser, int64, error) {
	res, err := c.send(ctx, c.stream, http.MethodGet, key, nil, nil, 0, sha256Hex(nil))
	if err != nil {
		return nil, 0, err
	}
	if err := expect(res, http.StatusOK); err != nil {
		res.Body.Close()
		return nil, 0, err
	}
	return &lengthChecked{body: res.Body, want: res.ContentLength}, res.ContentLength, nil
}

type lengthChecked struct {
	body io.ReadCloser
	want int64 // -1 when the server did not say
	got  int64
}

func (l *lengthChecked) Read(p []byte) (int, error) {
	n, err := l.body.Read(p)
	l.got += int64(n)
	if err == io.EOF && l.want >= 0 && l.got != l.want {
		return n, fmt.Errorf("s3: download stopped at %d of %d bytes: %w", l.got, l.want, io.ErrUnexpectedEOF)
	}
	return n, err
}

func (l *lengthChecked) Close() error { return l.body.Close() }
