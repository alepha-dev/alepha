package main

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/alepha-dev/bay/internal/connector"
)

/*
jobLog is a job's output on its way to Lore: spooled to disk first, then sent
up the socket as batched `log` frames (#Q3983).

The disk is what lets a job outlive its link. The process writes into the
spool whatever the connection is doing; the streamer reads from where it last
sent, and while the socket is down it simply does not advance. After a
reconnect it goes back a few frames, since a frame written into a socket that
was already dying may never have been read, and Lore keeps only the bytes past
what it already holds (each frame says its offset).

Each stream is one file under `<root>/jobs/<id>/`, and `sent.json` records how
far each was sent, so a Bay restarted after the job ended still replays the
tail before it re-acks the job.

Bounded: a job's spool stops growing at jobLogCap, and the frame that crosses
it says so.
*/
type jobLog struct {
	id  string
	dir string

	mu sync.Mutex
	// written and sent are byte counts per stream.
	written   map[string]int64
	sent      map[string]int64
	truncated bool
	noted     bool
	// recent holds the start offsets of the last frames sent per stream, and
	// sentGen the connection they went out on: a new connection rewinds to
	// the oldest of them.
	recent  map[string][]int64
	sentGen uint64
}

var jobStreams = []string{"stdout", "stderr"}

const (
	// jobLogCap is what one job may spool, both streams together.
	jobLogCap = 8 << 20
	// jobFrameBytes is the most a frame carries.
	jobFrameBytes = 16 << 10
	// jobFlushEvery is how often the streamer sends what is pending.
	jobFlushEvery = 500 * time.Millisecond
	// jobRewindFrames is how many frames a reconnect sends again.
	jobRewindFrames = 8
	// jobFramesPerFlush bounds one flush, so a burst is spread over ticks.
	jobFramesPerFlush = 64
)

// jobLogDir is where a job's spool lives under the Bay root.
func jobLogDir(root, id string) string { return filepath.Join(root, "jobs", id) }

// openJobLog opens (or creates) a job's spool, reading back how far each
// stream was written and sent.
func openJobLog(root, id string) (*jobLog, error) {
	l := &jobLog{id: id, dir: jobLogDir(root, id),
		written: map[string]int64{}, sent: map[string]int64{}, recent: map[string][]int64{}}
	if err := os.MkdirAll(l.dir, 0o700); err != nil {
		return nil, err
	}
	for _, stream := range jobStreams {
		if info, err := os.Stat(l.path(stream)); err == nil {
			l.written[stream] = info.Size()
		}
	}
	if raw, err := os.ReadFile(filepath.Join(l.dir, "sent.json")); err == nil {
		_ = json.Unmarshal(raw, &l.sent)
	}
	return l, nil
}

func (l *jobLog) path(stream string) string { return filepath.Join(l.dir, stream+".log") }

// writer is an io.Writer appending to one stream of the spool.
func (l *jobLog) writer(stream string) io.Writer { return jobLogWriter{l, stream} }

type jobLogWriter struct {
	l      *jobLog
	stream string
}

func (w jobLogWriter) Write(p []byte) (int, error) {
	w.l.append(w.stream, p)
	// Always the whole length: a pipe whose reader reports a short write
	// stalls the process, and a spool past its cap drops on purpose.
	return len(p), nil
}

func (l *jobLog) append(stream string, p []byte) {
	l.mu.Lock()
	defer l.mu.Unlock()
	total := l.written["stdout"] + l.written["stderr"]
	if total >= jobLogCap {
		l.truncated = true
		return
	}
	if room := int64(jobLogCap) - total; int64(len(p)) > room {
		p = p[:room]
		l.truncated = true
	}
	f, err := os.OpenFile(l.path(stream), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	n, _ := f.Write(p)
	f.Close()
	l.written[stream] += int64(n)
}

// Note appends a line of Bay's own to stderr: what happened to the job that
// the job could not print itself (a refused clone, a timeout).
func (l *jobLog) Note(line string) { l.append("stderr", []byte("bay: "+line+"\n")) }

// Step notes a step of the run with its time (#Q4218), so a slow job's log
// says where its time went: workspace ready, agent started, agent exited.
func (l *jobLog) Step(what string) {
	l.Note(time.Now().UTC().Format("15:04:05.000") + " " + what)
}

/*
flush sends what is pending, up to jobFramesPerFlush frames, and reports
whether anything is still pending. `gen` is the current connection; `final`
sends a trailing partial character too (the job has ended, nothing will
complete it).
*/
func (l *jobLog) flush(send func(any) error, gen uint64, final bool) (pending bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if gen != l.sentGen {
		// A new socket: what went into the old one may be lost.
		for _, stream := range jobStreams {
			if r := l.recent[stream]; len(r) > 0 {
				l.sent[stream] = r[0]
			}
		}
		l.recent = map[string][]int64{}
		l.sentGen = gen
	}
	frames := 0
	for _, stream := range jobStreams {
		for l.sent[stream] < l.written[stream] && frames < jobFramesPerFlush {
			chunk, err := l.read(stream, l.sent[stream], jobFrameBytes)
			if err != nil || len(chunk) == 0 {
				break
			}
			if !final || int64(len(chunk)) < l.written[stream]-l.sent[stream] {
				chunk = completeRunes(chunk)
				if len(chunk) == 0 {
					break
				}
			}
			frame := connector.NewLogFrame(l.id, stream, l.sent[stream], string(chunk))
			if l.truncated && !l.noted && l.sent[stream]+int64(len(chunk)) >= l.written[stream] {
				frame.Truncated = true
			}
			if err := send(frame); err != nil {
				l.persist()
				return true
			}
			if frame.Truncated {
				l.noted = true
			}
			l.recent[stream] = append(l.recent[stream], l.sent[stream])
			if len(l.recent[stream]) > jobRewindFrames {
				l.recent[stream] = l.recent[stream][1:]
			}
			l.sent[stream] += int64(len(chunk))
			frames++
		}
	}
	l.persist()
	for _, stream := range jobStreams {
		if l.sent[stream] < l.written[stream] {
			return true
		}
	}
	return false
}

func (l *jobLog) read(stream string, at int64, n int) ([]byte, error) {
	f, err := os.Open(l.path(stream))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	buf := make([]byte, n)
	got, err := f.ReadAt(buf, at)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}
	return buf[:got], nil
}

func (l *jobLog) persist() {
	raw, _ := json.Marshal(l.sent)
	_ = os.WriteFile(filepath.Join(l.dir, "sent.json"), raw, 0o600)
}

// stderrTail is the end of what the job printed on stderr, for the reason of
// a failed ack.
func (l *jobLog) stderrTail(n int) string {
	l.mu.Lock()
	size := l.written["stderr"]
	l.mu.Unlock()
	from := max(size-int64(n), 0)
	chunk, err := l.read("stderr", from, n)
	if err != nil {
		return ""
	}
	return string(completeRunes(chunk))
}

// remove deletes the spool, once everything in it reached Lore.
func (l *jobLog) remove() { _ = os.RemoveAll(l.dir) }

// completeRunes drops a trailing partial UTF-8 character, held back until
// the rest of it is written. Invalid bytes the job printed are kept: no later
// byte repairs them.
func completeRunes(b []byte) []byte {
	for i := len(b) - 1; i >= 0 && i >= len(b)-utf8.UTFMax; i-- {
		if utf8.RuneStart(b[i]) {
			if utf8.FullRune(b[i:]) {
				return b
			}
			return b[:i]
		}
	}
	return b
}
