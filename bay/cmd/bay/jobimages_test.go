package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

// An agent's image bodies stay out of its spooled log (#Q4455).

func imageResultLine(body string) string {
	return `{"type":"user","message":{"role":"user","content":[{"tool_use_id":"t1","type":"tool_result","content":[{"type":"image","source":{"type":"base64","media_type":"image/png","data":"` + body + `"}}]}]},"tool_use_result":{"type":"image","file":{"base64":"` + body + `","type":"image/png","originalSize":1}}}`
}

func TestImageStripper(t *testing.T) {
	body := strings.Repeat("iVBORw0KGgoAAAA", 800*1024/15)

	t.Run("an image body becomes a placeholder, the line stays valid JSON and the rest as it was", func(t *testing.T) {
		var out bytes.Buffer
		s := newImageStripper(&out)
		line := imageResultLine(body) + "\n"
		// A line larger than one write is stripped whole.
		for i := 0; i < len(line); i += 4096 {
			_, _ = s.Write([]byte(line[min(i, len(line)):min(i+4096, len(line))]))
		}
		got := out.String()
		want := imageResultLine(`[image/png, 600 KB]`) + "\n"
		if got != want {
			t.Fatalf("stripped line:\n%s\nwant:\n%s", cut(got, 400), want)
		}
		var event map[string]any
		if err := json.Unmarshal([]byte(got), &event); err != nil {
			t.Fatalf("the stripped line is not JSON: %v", err)
		}
	})

	t.Run("an image in MCP's own shape, named by mimeType, is stripped too", func(t *testing.T) {
		var out bytes.Buffer
		s := newImageStripper(&out)
		line := `{"type":"user","tool_use_result":[{"type":"image","data":"` + body + `","mimeType":"image/jpeg"}]}`
		_, _ = s.Write([]byte(line + "\n"))
		want := `{"type":"user","tool_use_result":[{"type":"image","data":"[image/jpeg, 600 KB]","mimeType":"image/jpeg"}]}` + "\n"
		if out.String() != want {
			t.Fatalf("stripped line:\n%s", cut(out.String(), 300))
		}
	})

	t.Run("text results, short strings and lines that are not JSON pass untouched", func(t *testing.T) {
		long := strings.Repeat("a", 4096)
		lines := []string{
			`{"type":"user","message":{"content":[{"type":"tool_result","content":"` + long + ` image/png"}]}}`,
			`{"type":"image","source":{"type":"base64","media_type":"image/png","data":"iVBOR"}}`,
			`not json "image/png" ` + long,
			`{"data":"` + long + `","type":"text/plain"}`,
		}
		for _, line := range lines {
			var out bytes.Buffer
			s := newImageStripper(&out)
			_, _ = s.Write([]byte(line + "\n"))
			if out.String() != line+"\n" {
				t.Fatalf("changed %q", cut(line, 80))
			}
		}
	})

	t.Run("a last line with no newline is written by Flush", func(t *testing.T) {
		var out bytes.Buffer
		s := newImageStripper(&out)
		_, _ = s.Write([]byte(`{"type":"result","result":"done"}`))
		if out.Len() != 0 {
			t.Fatal("a partial line was written before its end")
		}
		s.Flush()
		if out.String() != `{"type":"result","result":"done"}` {
			t.Fatalf("flushed %q", out.String())
		}
	})

	t.Run("ten 800 KB image results stay far under jobLogCap, and the reply is still read", func(t *testing.T) {
		log, err := openJobLog(t.TempDir(), "job")
		if err != nil {
			t.Fatal(err)
		}
		stripper := newImageStripper(log.writer("stdout"))
		scanner := newResultScanner(&claudeResult{})
		w := teeWriter{stripper, scanner}
		raw := 0
		for range 10 {
			line := imageResultLine(body) + "\n"
			raw += len(line)
			_, _ = w.Write([]byte(line))
		}
		_, _ = w.Write([]byte(`{"type":"result","is_error":false,"result":"All done.","total_cost_usd":0.5}`))
		stripper.Flush()
		if raw < jobLogCap {
			t.Fatalf("the stream is %d bytes, not past the cap", raw)
		}
		if spooled := log.written["stdout"]; spooled > 16<<10 || log.truncated {
			t.Fatalf("spooled %d bytes (truncated %v)", spooled, log.truncated)
		}
		if reply, isError, ok := scanner.Final(); !ok || isError || reply != "All done." {
			t.Fatalf("reply = %q, %v, %v", reply, isError, ok)
		}
	})
}
