# The `_headers` conformance fixture

One `_headers` file is applied by three kinds of host (epic #E49): Cloudflare,
Bay, and the app's own server. Two readers implement it, and this fixture is
what they both run:

- TypeScript: `packages/alepha/src/server/static/services/HeadersFileReader.ts`,
  run by `packages/alepha/src/server/static/__tests__/HeadersFileReader.spec.ts`.
- Go: `apps/bay/internal/headers`, run by its own tests.

It lives here because Bay's Go tests run in a container that sees only
`apps/bay`, read-only.

## Files

- `_headers`: the rules every case is applied with.
- `cases.json`: for each case, a request `path` (percent-encoded, as received,
  no query), the `status` the host answered with, the `defaults` the host put
  on the response, and the `expected` headers once the rules are applied.
  Header names are lowercase. The status is a record of what the host did; the
  rules never read it.
- `refusals.json` and `refusals/`: files a reader must refuse, each with the
  problems it must report as a reason code and the lines involved. Never
  message text, so the two languages agree on what is refused without sharing
  wording. The problems compare in order: the per-line ones in file order, then
  the ones between rules (too many, one path twice, a silent join).

## Checked against Cloudflare

Two implementations agreeing with each other prove little if both disagree
with Cloudflare, so `cases.json` is checked against Cloudflare's own code:
wrangler parses `_headers` and miniflare's asset worker applies it, the same
code a deploy runs. From the repository root:

```bash
node apps/bay/internal/headers/testdata/cloudflare.mjs
```

It boots workerd through `wrangler dev`, so it is not part of `yarn test`.
**Run it whenever `_headers` or `cases.json` changes.** Each case must answer,
for every header `_headers` names and every header the case lists, the value
`expected` or nothing. Last run: 2026-09-13, wrangler 4.130.0, all 14 cases
agree.

What it showed that the fixture now records: Cloudflare redirects a path whose
percent-encoding is lowercase (`/docs/caf%c3%a9`) with a 307 to the uppercase
form, and still applies the rules matching the lowercase path to that redirect.
