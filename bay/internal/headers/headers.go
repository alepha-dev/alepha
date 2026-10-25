// Package headers reads a `_headers` file: the one file that carries an app's
// headers to every host that serves its static files itself (epic #E49).
//
// The format is Cloudflare's, cut down to a subset every host applies alike,
// and its semantics are copied from Cloudflare's own code: the parser wrangler
// ships (`parseHeaders`) and the asset worker that applies the result
// (`attachCustomHeaders`). The TypeScript reader the build and the app's own
// server use, `packages/alepha/src/server/static/services/HeadersFileReader.ts`,
// implements the same subset, and both run the conformance fixture in
// testdata/, which was checked against Cloudflare itself (testdata/README.md).
//
// Its own package because two others need it and import neither each other:
// internal/deploy refuses a release whose file does not parse, and
// internal/proxy applies the rules to the files it serves.
package headers

import (
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"unicode"
	"unicode/utf16"
)

// Cloudflare's own limits: rules per file, and characters per line.
const (
	MaxRules      = 100
	MaxLineLength = 2000
)

// Rule is one rule of the file: a path, then the headers it removes and the
// headers it sets. Line numbers are 1-based.
type Rule struct {
	// Path is exactly as written: an exact path, or a path with one `*`
	// matching any characters, `/` included, or none.
	Path  string
	Line  int
	Unset []Unset
	Set   []Set
}

// Unset is a `! Name` line, applied before any set of the same rule.
type Unset struct {
	Name string
	Line int
}

// Set is a `Name: value` line.
type Set struct {
	Name  string
	Value string
	Line  int
}

// Problem is one thing wrong with a file. Reason is a code shared with the
// TypeScript reader (the fixture's refusal cases name it), never the message.
type Problem struct {
	Reason  string
	Lines   []int
	Message string
	// Path is, for a silent join, a request path both rules match.
	Path string
}

// Error is every problem of a file that was refused.
type Error struct {
	Source   string
	Problems []Problem
}

func (e *Error) Error() string {
	lines := make([]string, 0, len(e.Problems))
	for _, p := range e.Problems {
		where := e.Source
		if len(p.Lines) > 0 {
			nums := make([]string, len(p.Lines))
			for i, n := range p.Lines {
				nums[i] = fmt.Sprint(n)
			}
			where += ":" + strings.Join(nums, ", ")
		}
		lines = append(lines, where+": "+p.Message)
	}
	return e.Source + " is refused:\n" + strings.Join(lines, "\n")
}

var (
	// ruleLine is wrangler's LINE_IS_PROBABLY_A_PATH, verbatim. Note what it
	// catches that reads like a header: `Link:<https://x>` has no whitespace
	// before `://`, so Cloudflare takes the whole line for a host rule.
	ruleLine    = regexp.MustCompile(`^([^\s]+://|/)`)
	hostRule    = regexp.MustCompile(`^[^\s]+://`)
	placeholder = regexp.MustCompile(`:[A-Za-z]\w*`)
	splat       = regexp.MustCompile(`:splat(\W|$)`)
	// pathChars is RFC 3986 path characters plus `*`: anything else, a URL
	// parser rewrites, and Cloudflare matches the rewritten form.
	pathChars  = regexp.MustCompile(`^(?:[A-Za-z0-9\-._~!$&'()*+,;=:@/]|%[0-9A-Fa-f]{2})*$`)
	dotSegment = regexp.MustCompile(`(?i)^(?:\.|%2e){1,2}$`)
	// token is an RFC 9110 header name.
	token = regexp.MustCompile("^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+$")
)

// Read parses and validates a file, and refuses it whole on any problem.
func Read(text, source string) ([]Rule, error) {
	rules, problems := Parse(text)
	problems = append(problems, Validate(rules)...)
	if len(problems) > 0 {
		return nil, &Error{Source: source, Problems: problems}
	}
	return rules, nil
}

// Parse returns the rules of a file and every line-level problem in it. A
// rule whose path is refused is dropped with the lines under it, as Cloudflare
// drops it, so one bad path is one problem.
func Parse(text string) ([]Rule, []Problem) {
	var rules []Rule
	var problems []Problem
	var rule *Rule
	skipping := false

	closeRule := func() {
		if rule == nil {
			return
		}
		if len(rule.Set) == 0 && len(rule.Unset) == 0 {
			problems = append(problems, problem("empty-rule", []int{rule.Line},
				fmt.Sprintf("`%s` sets and removes no header. Cloudflare refuses a rule with no header line.", rule.Path)))
		} else {
			rules = append(rules, *rule)
		}
		rule = nil
	}

	for index, raw := range strings.Split(text, "\n") {
		n := index + 1
		line := trim(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		if length := len(utf16.Encode([]rune(line))); length > MaxLineLength {
			problems = append(problems, problem("line-too-long", []int{n},
				fmt.Sprintf("The line is %d characters long, over Cloudflare's limit of %d, which skips it.", length, MaxLineLength)))
			continue
		}

		if ruleLine.MatchString(line) {
			closeRule()
			if p, bad := pathProblem(line, n); bad {
				problems = append(problems, p)
				skipping = true
				continue
			}
			skipping = false
			rule = &Rule{Path: line, Line: n}
			continue
		}

		if skipping {
			continue
		}

		if rule == nil {
			problems = append(problems, problem("header-outside-rule", []int{n},
				"A header line comes before any path. Start a rule with a line beginning with `/`."))
			continue
		}

		if strings.HasPrefix(line, "!") {
			if !strings.HasPrefix(line, "! ") {
				problems = append(problems, problem("unset-without-space", []int{n},
					fmt.Sprintf("`%s` needs a space after `!` to remove a header: Cloudflare reads `!Name` as an invalid line.", line)))
				continue
			}
			name := trim(line[2:])
			if p, bad := nameProblem(name, n); bad {
				problems = append(problems, p)
				continue
			}
			rule.Unset = append(rule.Unset, Unset{Name: name, Line: n})
			continue
		}

		colon := strings.Index(line, ":")
		if colon < 0 {
			problems = append(problems, problem("invalid-line", []int{n},
				fmt.Sprintf("`%s` is neither `Name: value` nor `! Name`.", line)))
			continue
		}

		name := trim(line[:colon])
		value := trim(line[colon+1:])
		if p, bad := nameProblem(name, n); bad {
			problems = append(problems, p)
			continue
		}
		if value == "" {
			problems = append(problems, problem("empty-value", []int{n},
				fmt.Sprintf("`%s` has no value. To remove a header, write `! %s`.", name, name)))
			continue
		}
		if splat.MatchString(value) {
			problems = append(problems, problem("splat-in-value", []int{n},
				"`:splat` in a value is replaced by what `*` matched on Cloudflare only; no other host substitutes it."))
			continue
		}

		duplicate := false
		for _, earlier := range rule.Set {
			if strings.EqualFold(earlier.Name, name) {
				problems = append(problems, problem("duplicate-header", []int{earlier.Line, n},
					fmt.Sprintf("`%s` is set twice in `%s`, which Cloudflare joins into one value with `, `. Write one line with the value you mean.", name, rule.Path)))
				duplicate = true
				break
			}
		}
		if duplicate {
			continue
		}

		rule.Set = append(rule.Set, Set{Name: name, Value: value, Line: n})
	}
	closeRule()

	return rules, problems
}

// Validate returns the problems of a set of rules taken together: too many,
// one path twice, and two rules that would silently join a header.
func Validate(rules []Rule) []Problem {
	var problems []Problem

	if len(rules) > MaxRules {
		problems = append(problems, problem("too-many-rules", []int{rules[MaxRules].Line},
			fmt.Sprintf("The file has %d rules, over Cloudflare's limit of %d, which drops the rest.", len(rules), MaxRules)))
	}

	seen := map[string]Rule{}
	for _, r := range rules {
		if first, ok := seen[r.Path]; ok {
			problems = append(problems, problem("duplicate-path", []int{first.Line, r.Line},
				fmt.Sprintf("`%s` has two rules. Cloudflare keeps only the second one's headers, silently. Merge them into one.", r.Path)))
			continue
		}
		seen[r.Path] = r
	}

	for j := 1; j < len(rules); j++ {
		later := rules[j]
		for i := 0; i < j; i++ {
			earlier := rules[i]
			if earlier.Path == later.Path {
				continue
			}
			path, ok := overlap(earlier.Path, later.Path)
			if !ok {
				continue
			}
			for _, set := range later.Set {
				removed := false
				for _, u := range later.Unset {
					if strings.EqualFold(u.Name, set.Name) {
						removed = true
						break
					}
				}
				if removed {
					continue
				}
				for _, clash := range earlier.Set {
					if !strings.EqualFold(clash.Name, set.Name) {
						continue
					}
					p := problem("silent-join", []int{clash.Line, set.Line},
						fmt.Sprintf("`%s` and `%s` both set `%s`, and both match %s: it would get the two values joined. Start `%s` with `! %s` to replace it.",
							earlier.Path, later.Path, set.Name, path, later.Path, set.Name))
					p.Path = path
					problems = append(problems, p)
					break
				}
			}
		}
	}

	return problems
}

// Matches reports whether a rule's path matches a request path: the request's
// path as received, percent-encoded, without its query (in Go,
// r.URL.EscapedPath()). Never the file that ends up served.
func Matches(pattern, path string) bool {
	star := strings.Index(pattern, "*")
	if star < 0 {
		return pattern == path
	}
	prefix, suffix := pattern[:star], pattern[star+1:]
	return len(path) >= len(prefix)+len(suffix) &&
		strings.HasPrefix(path, prefix) &&
		strings.HasSuffix(path, suffix)
}

// Apply writes the rules matching path onto a response's headers, exactly as
// Cloudflare's asset worker does: every matching rule in file order; within a
// rule, removals first, then sets; the first set of a header replaces whatever
// the host put there, and a later rule's set of the same header is appended
// with ", ". Applies to every status alike: a 200, a 304, a fallback page.
func Apply(rules []Rule, path string, h http.Header) {
	// Cloudflare's setMap, kept across rules: it is what makes a second rule's
	// set an append rather than a replace.
	written := map[string]bool{}
	for _, r := range rules {
		if !Matches(r.Path, path) {
			continue
		}
		for _, u := range r.Unset {
			h.Del(u.Name)
		}
		for _, s := range r.Set {
			key := http.CanonicalHeaderKey(s.Name)
			if written[key] {
				if existing := h.Values(key); len(existing) > 0 {
					h.Set(key, strings.Join(existing, ", ")+", "+s.Value)
					continue
				}
				h.Set(key, s.Value)
				continue
			}
			h.Set(key, s.Value)
			written[key] = true
		}
	}
}

// overlap returns a request path both patterns match, if one exists. Exact for
// patterns with at most one `*`: two can match one path exactly when the text
// before each star is prefix-compatible and the text after it
// suffix-compatible, and then the longer prefix followed by the longer suffix
// is such a path.
func overlap(a, b string) (string, bool) {
	starA, starB := strings.Index(a, "*"), strings.Index(b, "*")
	switch {
	case starA < 0 && starB < 0:
		return a, a == b
	case starA < 0:
		return a, Matches(b, a)
	case starB < 0:
		return b, Matches(a, b)
	}
	prefixA, suffixA := a[:starA], a[starA+1:]
	prefixB, suffixB := b[:starB], b[starB+1:]
	prefix, shortPrefix := prefixA, prefixB
	if len(prefixB) > len(prefixA) {
		prefix, shortPrefix = prefixB, prefixA
	}
	suffix, shortSuffix := suffixA, suffixB
	if len(suffixB) > len(suffixA) {
		suffix, shortSuffix = suffixB, suffixA
	}
	if !strings.HasPrefix(prefix, shortPrefix) || !strings.HasSuffix(suffix, shortSuffix) {
		return "", false
	}
	return prefix + suffix, true
}

func pathProblem(line string, n int) (Problem, bool) {
	switch {
	case hostRule.MatchString(line):
		return problem("host-rule", []int{n},
			fmt.Sprintf("`%s` names a host. Only paths are supported: Bay and the app's own server serve one host each.", line)), true
	case placeholder.MatchString(line):
		return problem("placeholder", []int{n},
			fmt.Sprintf("`%s` has a named placeholder, which only Cloudflare understands. Use one `*`.", line)), true
	case strings.Count(line, "*") > 1:
		return problem("multiple-wildcards", []int{n},
			fmt.Sprintf("`%s` has more than one `*`. Cloudflare drops such a rule silently; one is the limit.", line)), true
	}
	bad := !pathChars.MatchString(line)
	for _, segment := range strings.Split(line, "/") {
		if dotSegment.MatchString(segment) {
			bad = true
		}
	}
	if bad {
		return problem("path-encoding", []int{n},
			fmt.Sprintf("`%s` is not written the way a browser sends it. Percent-encode it and drop any `.` or `..` segment: rules match the request's encoded path, and Cloudflare rewrites anything else.", line)), true
	}
	return Problem{}, false
}

func nameProblem(name string, n int) (Problem, bool) {
	if token.MatchString(name) {
		return Problem{}, false
	}
	message := fmt.Sprintf("`%s` is not a header name: no spaces, and none of `\"(),/:;<=>?@[\\]{}`.", name)
	if name == "" {
		message = "The header has no name."
	}
	return problem("header-name", []int{n}, message), true
}

// problem builds a Problem, its lines ascending: a silent join found between
// rules the build merged can name a later line first.
func problem(reason string, lines []int, message string) Problem {
	sorted := append([]int(nil), lines...)
	sort.Ints(sorted)
	return Problem{Reason: reason, Lines: sorted, Message: message}
}

// trim is JavaScript's String.prototype.trim, which is what Cloudflare's
// parser calls: unlike strings.TrimSpace it strips a byte order mark and
// keeps U+0085.
func trim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool {
		return r == '\uFEFF' || (unicode.IsSpace(r) && r != '\u0085')
	})
}
