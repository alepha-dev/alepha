package main

import "testing"

// parseKeepReleases guards a flag that DELETES things, so every rejection below
// is a case where accepting the input would have quietly removed releases an
// operator still needed.
func TestParseKeepReleases(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		want    int
		wantErr bool
	}{
		{"an ordinary count", "5", 5, false},
		{"the floor", "2", 2, false},
		{"a large count", "40", 40, false},
		// One release means `watchAndRollback` has nowhere to return to: the
		// release it wants is the one this would have deleted. The safety net
		// would fail silently, at the only moment it matters.
		{"one leaves rollback with no target", "1", 0, true},
		// The dangerous reading of a zero-valued or misparsed flag is "keep
		// nothing". It must never be spelled this way.
		{"zero", "0", 0, true},
		{"negative", "-3", 0, true},
		{"not a number", "five", 0, true},
		{"empty", "", 0, true},
		// `strconv.Atoi` rejects these, and it must stay that way: a silent
		// truncation of "5.9" to 5 is a value the operator never typed.
		{"a decimal", "5.9", 0, true},
		{"trailing text", "5releases", 0, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseKeepReleases(tc.in)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("parseKeepReleases(%q) = %d, want an error", tc.in, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseKeepReleases(%q) = %v, want %d", tc.in, err, tc.want)
			}
			if got != tc.want {
				t.Fatalf("parseKeepReleases(%q) = %d, want %d", tc.in, got, tc.want)
			}
		})
	}
}
