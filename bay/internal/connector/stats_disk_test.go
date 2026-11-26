package connector

import "testing"

func TestDiskPercentOf(t *testing.T) {
	total, used := uint64(200), uint64(113)
	if got := diskPercentOf(Host{DiskTotalBytes: &total, DiskUsedBytes: &used}); got == nil || *got != 56.5 {
		t.Fatalf("got %v, want 56.5", got)
	}
	if got := diskPercentOf(Host{}); got != nil {
		t.Fatalf("no disk read, got %v", *got)
	}
}
