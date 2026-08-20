# @alepha/sigil

The reporting half of a sigil. Add it to an Alepha app and the app reports page
views, Web Vitals, and client and server errors to the sink you name: a Lore
instance, or anything else that serves the sigil ingest endpoint.

Named for the credential it holds, not for what it collects. The previous name
(`@alepha/telemetry`) suggested a generic collector you could point anywhere; it
is not one. It speaks one protocol, to one kind of endpoint.

## Integration

```ts
import { AlephaSigil } from "@alepha/sigil";

alepha.with(AlephaSigil);
```

Then set one server-side variable:

```
SIGIL_KEY=sg_my-project_…
```

That is the whole enrolment. The key is the only secret and the only required
variable: it authorises the reporting *and* names the project reported into, so
there is nothing else for the app to be told.

Its absence is a supported mode rather than a misconfiguration. Without a key
the module still captures, and aggregated errors go to the app's own logger
instead. That is the headless case: an app that must not phone home to
anything.

### The optional two

| | |
|---|---|
| `SIGIL_SINK` | origin of the sink. Defaults to `https://lore.alepha.dev`; set it to self-host. |
| `SIGIL_CONFIG` | JSON object of switches over what to collect. Every field optional. |
| `SIGIL_SALT` | overrides the secret salting the daily visitor hash. Falls back to `APP_SECRET`. |

`SIGIL_CONFIG` turns things off, never on:

```
SIGIL_CONFIG={"vitals":false,"feedbackButton":"hidden"}
```

Fields: `analytics`, `blights`, `vitals`, `feedback` (booleans, all default
true), `feedbackButton` (a corner, or `hidden`), and
`feedbackButtonExcludedPaths` (path globs the button stays off).

It is deliberately an environment variable rather than something fetched from
the sink. A config fetched at runtime cannot survive a serverless isolate, which
discards the cache between requests and so pays the round trip in front of the
first byte of every cold page, and it cannot survive a prerender, which bakes
the answer into HTML at build time and leaves you with a kill-switch that needs
a redeploy.

## The key names the project

A token is shaped `sg_<project>_<secret>`. The slug is not a second credential
and protects nothing: it is already public, printed into the feedback link on
every page the app renders. What it buys is that the app can address its own
project without asking the sink first, which is what removes the last round trip
from a cold render.

Nothing on the wire carries it. The envelope has no project field, and the sink
resolves one from the token alone, so an app cannot report into a project its
credential does not name.

A key minted before this format keeps working. It reports normally and loses
only the feedback link, since the link is the one thing the slug was ever for.
Rotate it on the sink to get one back.

## The browser never holds the key

The browser posts to `/api/sigil/ingest` on the app's own origin, and the app
forwards to the sink server-to-server. So the enrolment key stays on the server,
there is no CORS to configure, and no third-party origin appears in the page.

Visitor identity is a daily-rotating hash over the request's host and address,
salted with a secret that never leaves the server. No cookie, no local storage,
nothing that follows a person between sites or across days.

## The feedback button mounts itself

Importing the module is the whole integration: `<SigilRoot />` is pushed into
the root component list, and it renders nothing unless there is a feedback URL
to offer and the current path is not excluded.

An app that would rather place the link itself sets `feedbackButton` to `hidden`
and reads the URL directly:

```tsx
import { useFeedbackUrl } from "@alepha/sigil/react";
```

`useFeedbackUrl()` returns the URL and nothing else, and `<SigilRoot />` hides
itself when there is none, so the two never fight.

## Error grouping

Errors are aggregated by fingerprint before they leave the process, with stack
frames normalized so that bundle hashes and `:line:column` do not split one
fault into a new group on every deploy. What reaches the sink is a count per
fingerprint, not one payload per occurrence, which is what keeps storage bound
by how many distinct faults exist rather than by how much traffic you have.
