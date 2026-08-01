package proxy

import (
	"sync"
	"time"
)

/*
lastSeen accumulates, in memory, when each app last answered a request.

In memory and not straight to the store because this sits on the hot path:
every request for every app goes through it, and `state.Store` writes the whole
document with temp-and-rename. A ticker drains this instead, so the number of
disk writes tracks the number of apps rather than the number of requests.

Losing the tail on a crash is the accepted cost. The question this feeds is
"has anything touched this app in the last N weeks?", and no answer to that
changes because the final few minutes went missing.
*/
type lastSeen struct {
	mu sync.Mutex
	at map[string]time.Time
}

// touch records that an app answered a request at `now`.
//
// Keeps the newest of a batch: many requests land between two ticks, and the
// first one would make a busy app look progressively staler with every flush.
func (l *lastSeen) touch(key string, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.at == nil {
		l.at = map[string]time.Time{}
	}
	if prev, ok := l.at[key]; ok && prev.After(now) {
		return
	}
	l.at[key] = now
}

// drain returns what has accumulated and clears it.
//
// Clearing is what keeps the write rate proportional to traffic: without it,
// every tick would rewrite state.json for every app that has ever been used,
// forever, including the ones that have seen nothing for months.
func (l *lastSeen) drain() map[string]time.Time {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := l.at
	l.at = nil
	if out == nil {
		return map[string]time.Time{}
	}
	return out
}

/*
countsAsTraffic reports whether a response means somebody is using the app.

Not every request is evidence of use, and on Bay that distinction is
load-bearing rather than fussy. Let's Encrypt publishes every certificate it
issues to the Certificate Transparency logs, so each app's domain lands in a
public, machine-readable list within minutes of getting HTTPS — and gets
scanned. A prototype nobody has ever shared still receives traffic forever.

Count raw requests and every abandoned app reads as freshly used, which is the
one conclusion the staleness badge exists to prevent. So: the app must have
answered. A bot walking a wordlist collects 404s and moves nothing; a person
loading the page gets a 200 and does.

5xx is excluded for a second reason. An app that is crash-looping returns 502
from the proxy on every request, and counting those would rank the most broken
app on the host as the most alive.
*/
func countsAsTraffic(status int) bool {
	return status < 400
}
