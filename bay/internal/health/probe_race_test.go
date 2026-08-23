package health

import (
	"context"
	"sync"
	"testing"
)

// One Probe is shared by every deploy handler and every watch goroutine. The
// lazily assigned default client used to be written without synchronisation,
// which `go test -race` flagged on the first two concurrent checks.
func TestConcurrentChecksShareOneProbeSafely(t *testing.T) {
	p := &Probe{}
	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			// Port 1 answers nothing; the outcome is irrelevant, the access is not.
			_, _, _ = p.Check(context.Background(), 1)
		}()
	}
	wg.Wait()
}
