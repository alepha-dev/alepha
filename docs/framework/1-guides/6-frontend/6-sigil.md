# Sigil (analytics, vitals & errors)

`@alepha/sigil` makes an Alepha app report what it is doing: page views,
Web Vitals, and client and server errors - to the **sink** the app names. A
sink is anything serving the two sigil endpoints; Lore is one.

```typescript
import { Alepha } from "alepha";
import { AlephaSigil } from "@alepha/sigil";

Alepha.create().with(AlephaSigil).with(App).start();
```

Then one server-side variable:

```bash
SIGIL_KEY=sg_alepha_…
```

That is the whole enrolment. The key is the only secret and the only required
variable: it authorises the reporting _and_ names the project reported into.

| Variable       | Required |                                                                                 |
| -------------- | -------- | ------------------------------------------------------------------------------- |
| `SIGIL_KEY`    | **yes**  | the sigil token the sink minted for this app - **secret, server-only**          |
| `SIGIL_SINK`   | no       | origin of the sink. Defaults to `https://lore.alepha.dev`; set it to self-host  |
| `SIGIL_CONFIG` | no       | JSON: switches over what this app reports                                       |
| `SIGIL_SALT`   | no       | overrides the secret salting the daily visitor hash. Falls back to `APP_SECRET` |

Without a key the module is **inert**: it still captures and still collapses a
crash loop into one logged warning, but nothing leaves the machine. It says so
at boot and carries on, because telemetry is not worth an outage. That is the
headless case, for an app that must not phone home to anything.

`SIGIL_SINK` defaults to the public Lore instance the way `npm` defaults to
`registry.npmjs.org` - a commons that is there if you want it and one variable
away if you do not. The default is inert on its own: nothing is sent without a
key, and a key minted by your own instance simply 401s against the public one
rather than leaking into it. A missing scheme is filled in, so
`lore.example.com` and `https://lore.example.com` both work.

## The key names the project

A token is shaped `sg_<project>_<secret>`. The slug is not a second credential
and protects nothing - it is already public, printed into the feedback link on
every page the app renders. What it buys is that the app can address its own
project without asking the sink first, which is what removes the last round
trip from a cold render.

Nothing on the wire carries it. The envelope has no project field, and the sink
resolves one from the token alone, so an app cannot report into a project its
credential does not name.

A key minted before this format keeps working: it reports normally and loses
only the feedback link, since the link is the one thing the slug was ever for.
Rotate it on the sink to get one back.

## Turning things off

`SIGIL_CONFIG` is optional, and every field in it turns something **off** -
except `reportOutsideProduction`, the one switch that turns something on:

```bash
SIGIL_CONFIG={"vitals":false,"feedbackButton":"hidden"}
```

| Field                         | Default          |                                                                          |
| ----------------------------- | ---------------- | ------------------------------------------------------------------------ |
| `analytics`                   | `true`           | page views                                                               |
| `blights`                     | `true`           | client and server errors                                                 |
| `vitals`                      | `true`           | web-vitals samples                                                       |
| `feedback`                    | `true`           | whether there is a feedback link at all                                  |
| `feedbackButton`              | `"bottom-right"` | `"hidden"`, `"bottom-left"` or `"bottom-right"`                          |
| `feedbackButtonExcludedPaths` | `[]`             | path globs the button stays off - `*` within a segment, `**` across them |
| `reportOutsideProduction`     | `false`          | send from a non-production process too - see below                       |

`feedback` and `feedbackButton` are separate on purpose: `feedback: false` means
there is no URL at all, while `feedback: true` with the button `hidden` gives
you the URL through `useFeedbackUrl()` to render wherever you like.

The resolved sink and where it came from are logged at boot, so a default is
never a surprise.

## Production only, on both halves

A key is a credential, not permission to report from a laptop. Outside
production the browser bootstrap returns early and the server sink captures
locally and sends nothing - the same treatment an app with no key gets, errors
going to the logger instead. Without that gate every `alepha dev` session, test
container and CI job counted as traffic on the project's own dashboard, so the
numbers you read to decide things included you refreshing a page.

A staging deployment that needs to prove its enrolment before production does
turns the server half back on:

```bash
SIGIL_CONFIG={"reportOutsideProduction":true}
```

The decision is logged at boot either way, so an empty staging dashboard has a
line explaining itself.

The browser half does not read that switch. A page is either a production page
or it is not, and a switch that made a dev page report would put your own
browsing in the same numbers.

## The browser never holds the key

The browser posts to `/api/sigil/ingest` on the app's **own origin**; the app
then forwards to the sink server-to-server.

```txt
browser ──(same-origin)──▶ /api/sigil/ingest ──(server→server, SIGIL_KEY)──▶ lore.example.com
```

So the key never reaches the page, there is no CORS to configure, and no
third-party origin appears in your app.

## Cookieless by construction

Visitor identity is a hash of the request, salted with a value that rotates
daily **and** with the app's own host. Nothing follows a person between sites,
and nothing follows them across days.

There is no cookie and no local storage, which is what keeps this outside the
scope of a consent banner.

## Changing what it collects, without a rebuild

`SIGIL_CONFIG` is a variable, so on any platform with a dashboard you edit it
and the next request reads the new value. No CI, no rebuild.

It used to be fetched from the sink instead, and that failed in two opposite
ways. On a serverless runtime the isolate is discarded between requests, so the
cached answer was gone on nearly every one and fetched again - awaited in front
of the first byte of every cold page. On a prerendered app the same code ran
during the _build_, so the answer was baked into the HTML and could not change
until the next deploy: a kill-switch that needs a redeploy, which is the thing
the fetch existed to avoid.

**A page can still outlive its config** - a prerendered file, a cached
response, a restored document. The config sent to the browser carries the time
it was resolved, and a page whose stamp has aged asks for the current one on its
first ingest call, which is a call it was making anyway. Until that returns it
acts on what it was served with, so at most one envelope goes out under an old
config, and the server drops what it should not have accepted.

That first call waits for the page to settle - the largest contentful paint, or
two seconds, whichever comes first - rather than going out the moment the app
hydrates. It then carries the vitals collected by then instead of leaving them
for a second request. The visible consequence is that a feedback button on a
prerendered page appears a moment after the content rather than with it.

## A page load is one request

A server-rendered page carries a config stamped for this visit, so it has
nothing to ask for and no reason to hurry. It waits instead for the last fact
about the load to be known: whether the visitor engaged, which is settled ten
seconds in. The pageview, TTFB, FCP, LCP and the engagement verdict then leave
together.

Without that wait they do not. The queue debounces for five seconds, so the
first producer to finish arms the timer and the load reports itself at +5s -
before the engagement verdict exists, which then pays for a request of its own
at +15s. The wait costs nothing and removes that second request.

A visitor who leaves before the ten seconds are up is still reported: the wait
suspends the debounce, not the queue, and `pagehide` and `visibilitychange`
flush directly. Their envelope simply carries no engagement, which is correct.

Two things still leave separately, and both are deliberate. A page whose config
has gone stale asks early, as above, because its feedback button cannot render
until the answer arrives; its engagement follows ten seconds later. And CLS and
INP are only final when the visit is over - CLS accumulates and INP is the worst
interaction of the whole session - so they go out in a `keepalive` beacon at
`visibilitychange`, which is the one request a visitor never waits on.

The sink decides separately what it _keeps_. What an app sends is its own
business; a sigil whose kinds withhold vitals discards them on arrival however
enthusiastic the sender.

## Errors are grouped before they leave

Errors are aggregated by fingerprint in the process, with stack frames
normalized so that bundle hashes and `:line:column` do not split one fault into
a fresh group on every deploy. What reaches the sink is a count per fingerprint,
not one payload per occurrence.

This is what keeps storage bound by how many distinct faults exist rather than
by how much traffic you have.

## The feedback button mounts itself

Importing the module is the whole integration: `<SigilRoot />` is pushed into
the root components automatically, so the floating feedback button appears with
no JSX to place. Control it from `SIGIL_CONFIG` - `feedbackButton: "hidden"`
keeps it out of the tree, `feedbackButtonExcludedPaths` keeps it off specific
routes.

To render your own link instead, `@alepha/sigil` re-exports the pieces:

```tsx
import { useFeedbackUrl } from "@alepha/sigil";

// Renders only when the sink hands out a feedback URL
// and the current path is not excluded.
const feedback = useFeedbackUrl();
return feedback ? <a href={feedback}>Report a problem</a> : null;
```

Pair it with `feedbackButton: "hidden"` so the built-in button and your link do
not both show. (`react` and `react-dom` are peer dependencies of the package
either way, which is why the main entry is allowed to pull React: a headless
API app had to install them anyway.)
