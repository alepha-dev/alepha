package runtimes

import (
	"fmt"
	"sort"
	"strings"
)

/*
Image is one runtime image Bay supports: a runtime, a major, the tag that names
it and the digest this Bay release pins.

The archive an app ships runs inside it (epic E73): Bay no longer installs
interpreters, it picks an image. The major comes from the manifest, which
`alepha build` fills from `engines` in package.json, else from the major that
ran the build, so the app runs on the runtime it was built for.

Debian slim, never Alpine: musl breaks or rebuilds native modules (sharp,
bcrypt, several SQLite drivers), and an app that works on the developer's
machine must not fail on the host for a libc it never chose.
*/
type Image struct {
	Runtime string
	Major   string
	// Tag is the moving name, e.g. "node:26-slim". What `bay runtimes update`
	// re-resolves to pick up a patched base image.
	Tag string
	// Digest is what this Bay release was tested with.
	Digest string
}

// Ref is the pullable reference, tag and digest both: the digest decides
// what runs, the tag says to a human what it is.
func (i Image) Ref() string {
	return i.Tag + "@" + i.Digest
}

/*
Images is the table this Bay release supports, pinned by digest.

Refreshed with each Bay release. Between releases, `bay runtimes update`
resolves each tag to its newest digest and records it in the state file, so a
security patch to a base image reaches the apps without waiting for Bay.
*/
var Images = []Image{
	{Runtime: "node", Major: "22", Tag: "node:22-slim", Digest: "sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d"},
	{Runtime: "node", Major: "24", Tag: "node:24-slim", Digest: "sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205"},
	{Runtime: "node", Major: "26", Tag: "node:26-slim", Digest: "sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec"},
	{Runtime: "bun", Major: "1", Tag: "oven/bun:1-slim", Digest: "sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4"},
}

/*
DefaultMajor is what a manifest that names no major runs on.

Only builds older than the runtime major in the manifest hit it, and they get a
warning that says so: the app may have been built for another major, and the
fix is a rebuild, not a guess that happens to work.
*/
var DefaultMajor = map[string]string{"node": "26", "bun": "1"}

/*
Selection is the image an instance runs on, and why.

Warning is non-empty when Bay had to decide something the build did not say,
and is meant to be shown to whoever deployed.
*/
type Selection struct {
	Ref     string
	Image   Image
	Warning string
	// Override is true when the instance named its own image.
	Override bool
}

/*
Select picks the image for a runtime and major.

  - override, when set, wins outright: the operator named an image (an Alpine
    variant, a custom base) and owns that choice
  - locks maps a tag to the digest `bay runtimes update` last resolved; it
    beats the table's digest, being newer by construction
  - a major the table does not list is refused with the list that is
    supported, never run on a nearby one
*/
func Select(runtime, major, override string, locks map[string]string) (Selection, error) {
	if override != "" {
		return Selection{Ref: override, Override: true}, nil
	}
	var warning string
	if major == "" {
		def, ok := DefaultMajor[runtime]
		if !ok {
			return Selection{}, fmt.Errorf("no runtime image for %q: Bay runs node and bun", runtime)
		}
		major = def
		warning = fmt.Sprintf("the manifest names no %s major, so it runs on %s %s; rebuild with a current alepha to record the one it was built for",
			runtime, runtime, major)
	}
	for _, img := range Images {
		if img.Runtime != runtime || img.Major != major {
			continue
		}
		ref := img.Ref()
		if locked, ok := locks[img.Tag]; ok && locked != "" {
			ref = locked
		}
		return Selection{Ref: ref, Image: img, Warning: warning}, nil
	}
	supported := Supported(runtime)
	if len(supported) == 0 {
		return Selection{}, fmt.Errorf("no runtime image for %q: Bay runs node and bun", runtime)
	}
	return Selection{}, fmt.Errorf("%s %s is not supported by this Bay; supported majors: %s. Build for one of them (engines.%s in package.json), or upgrade Bay",
		runtime, major, strings.Join(supported, ", "), runtime)
}

// Supported lists the majors the table has for a runtime, lowest first.
func Supported(runtime string) []string {
	var majors []string
	for _, img := range Images {
		if img.Runtime == runtime {
			majors = append(majors, img.Major)
		}
	}
	sort.Slice(majors, func(i, j int) bool { return numeric(majors[i]) < numeric(majors[j]) })
	return majors
}
