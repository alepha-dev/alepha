# The `_headers` conformance fixture (copy)

One `_headers` file is applied by three kinds of host: Cloudflare, Bay, and the
app's own server. Two readers implement it, and both run this fixture:

- TypeScript: `HeadersFileReader.ts`, run by `HeadersFileReader.spec.ts` here.
- Go: Bay's `internal/headers`, in `github.com/alepha-dev/bay`.

**Bay's `internal/headers/testdata/` is the authority**; this directory is a
copy, made when Bay left the monorepo (#E72). A change to the rules or the
cases lands in both, in step: the two readers agree only as long as they run
the same file. Bay's copy also carries `cloudflare.mjs`, which checks the cases
against Cloudflare's own code, and the field-by-field description.
