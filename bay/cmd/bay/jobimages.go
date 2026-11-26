package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"sync"
)

/*
imageStripper sits between an agent's stdout and its spool (#Q4455): every
whole line it is given goes on with the base64 body of each image in it
replaced by a short placeholder, `[image/png, 855 KB]`, and the rest of the
line byte for byte as it was. Claude Code prints an image it reads inside the
tool result line of its stream-json, so a job that looks at screens would
otherwise fill the log's cap with bytes nobody reads.

It works on lines, never on write chunks: a line is held until its newline
(or Flush, at the job's end). A line past maxStrippedLine is written through
as it came, so a runaway line costs no more memory than that.

An image body is a JSON string under `data` or `base64`, at least
minImageBody long, in an object whose `media_type`, `type` or `mimeType` names
an image (MCP's own image content carries `mimeType`):
the `source` of an image block (`{"type":"base64","media_type":"image/png",
"data":…}`) and Claude Code's own `file` (`{"base64":…,"type":"image/png"}`).
A text tool result is never touched, nor a line that is not JSON.
*/
type imageStripper struct {
	mu   sync.Mutex
	out  io.Writer
	line []byte
	// passing writes the rest of a line already past maxStrippedLine.
	passing bool
}

const (
	// maxStrippedLine is the longest line held to be stripped.
	maxStrippedLine = 64 << 20
	// minImageBody is the shortest string read as an image body.
	minImageBody = 1024
)

func newImageStripper(out io.Writer) *imageStripper { return &imageStripper{out: out} }

func (s *imageStripper) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rest := p
	for len(rest) > 0 {
		i := bytes.IndexByte(rest, '\n')
		if i < 0 {
			s.hold(rest)
			break
		}
		s.hold(rest[:i+1])
		if !s.passing {
			_, _ = s.out.Write(stripImages(s.line))
		}
		s.line, s.passing = s.line[:0], false
		rest = rest[i+1:]
	}
	return len(p), nil
}

func (s *imageStripper) hold(b []byte) {
	if s.passing {
		_, _ = s.out.Write(b)
		return
	}
	if len(s.line)+len(b) > maxStrippedLine {
		_, _ = s.out.Write(s.line)
		_, _ = s.out.Write(b)
		s.line, s.passing = s.line[:0], true
		return
	}
	s.line = append(s.line, b...)
}

// Flush writes a last line the stream did not end with a newline.
func (s *imageStripper) Flush() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.line) > 0 && !s.passing {
		_, _ = s.out.Write(stripImages(s.line))
	}
	s.line, s.passing = s.line[:0], false
}

// stripImages answers the line with its image bodies replaced, or the line
// itself when it holds none.
func stripImages(line []byte) []byte {
	if len(line) < minImageBody || !bytes.Contains(line, []byte(`"image/`)) {
		return line
	}
	spans := imageSpans(line)
	if len(spans) == 0 {
		return line
	}
	out := make([]byte, 0, len(line)/8)
	at := 0
	for _, span := range spans {
		out = append(out, line[at:span.from]...)
		placeholder, _ := json.Marshal(fmt.Sprintf("[%s, %s]", span.media, imageSize(span.to-span.from-2)))
		out = append(out, placeholder...)
		at = span.to
	}
	return append(out, line[at:]...)
}

type imageSpan struct {
	// from and to bound the JSON string, quotes included.
	from, to int
	media    string
}

// imageFrame is one open object or array while a line is walked.
type imageFrame struct {
	object bool
	// key is the object's key whose value comes next.
	key       string
	expectKey bool
	media     string
	bodies    []imageSpan
}

// imageSpans walks the line's JSON and answers each image body's position,
// in order. A line that is not JSON answers none.
func imageSpans(line []byte) []imageSpan {
	dec := json.NewDecoder(bytes.NewReader(line))
	var stack []*imageFrame
	var spans []imageSpan
	for {
		before := int(dec.InputOffset())
		token, err := dec.Token()
		if err != nil {
			if err == io.EOF {
				break
			}
			return nil
		}
		var top *imageFrame
		if len(stack) > 0 {
			top = stack[len(stack)-1]
		}
		if top != nil && top.object && top.expectKey {
			if key, ok := token.(string); ok {
				top.key, top.expectKey = key, false
				continue
			}
		}
		switch t := token.(type) {
		case json.Delim:
			if t == '{' || t == '[' {
				stack = append(stack, &imageFrame{object: t == '{', expectKey: t == '{'})
				continue
			}
			stack = stack[:len(stack)-1]
			if top.object && top.media != "" {
				for _, body := range top.bodies {
					body.media = top.media
					spans = append(spans, body)
				}
			}
			// The closed value was the parent's: its next token is a key.
			if len(stack) > 0 && stack[len(stack)-1].object {
				stack[len(stack)-1].expectKey = true
			}
		case string:
			if top != nil && top.object {
				switch top.key {
				case "media_type", "type", "mimeType", "mime_type":
					if strings.HasPrefix(t, "image/") {
						top.media = t
					}
				case "data", "base64":
					if len(t) >= minImageBody {
						from := before + bytes.IndexByte(line[before:], '"')
						top.bodies = append(top.bodies, imageSpan{from: from, to: int(dec.InputOffset())})
					}
				}
				top.expectKey = true
			}
		default:
			if top != nil && top.object {
				top.expectKey = true
			}
		}
	}
	// Spans close inner objects first; put them back in line order.
	for i := 1; i < len(spans); i++ {
		for j := i; j > 0 && spans[j].from < spans[j-1].from; j-- {
			spans[j], spans[j-1] = spans[j-1], spans[j]
		}
	}
	return spans
}

// imageSize says how large the decoded body of a base64 string of n
// characters is.
func imageSize(n int) string {
	size := n * 3 / 4
	if size < 1024 {
		return fmt.Sprintf("%d B", size)
	}
	if size < 1<<20 {
		return fmt.Sprintf("%d KB", (size+512)/1024)
	}
	return fmt.Sprintf("%.1f MB", float64(size)/(1<<20))
}
