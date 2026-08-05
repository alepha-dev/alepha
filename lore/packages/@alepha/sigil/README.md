# @alepha/sigil

The reporting half of a sigil. Add it to an Alepha app and the app reports page
views, Web Vitals, and client and server errors to the sink you name — a Lore
instance, or anything else that serves the two sigil endpoints.

Named for the credential it holds, not for what it collects. The previous name
(`@alepha/telemetry`) suggested a generic collector you could point anywhere;
it is not — it speaks one protocol, to one kind of endpoint.

## Integration

```ts
import { AlephaSigil } from "@alepha/sigil";

alepha.with(AlephaSigil);
```

Then set two server-side variables:

| | |
|---|---|
| `SIGIL_SINK` | origin of the sink, e.g. `https://lore.example.com` |
| `SIGIL_KEY` | the sigil token the sink minted for this app + environment — **secret, server-only** |

Both are optional, and their absence is a supported mode rather than a
misconfiguration: without a sink the module still captures, and aggregated
errors go to the logger instead. That is the headless case — an app that must
not phone home to anything.

Everything else about *how much* to collect comes from the sink at runtime, not
from env. A kill-switch that needs a redeploy is a kill-switch nobody reaches in
time.

## The browser never holds the key

The browser posts to `/api/sigil/ingest` on the app's own origin, and the app
forwards to the sink server-to-server. So the enrolment key stays on the
server, there is no CORS to configure, and no third-party origin appears in the
page.

Visitor identity is a daily-rotating hash salted with the request's own host —
no cookie, no local storage, nothing that follows a person between sites or
across days.

## Nothing is mounted for you

The feedback button used to be injected into every host app's React tree as a
root component. It still ships — but the app decides where it goes:

```tsx
import { SigilRoot, useFeedbackUrl } from "@alepha/sigil/react";

<SigilRoot />; // the batteries-included floating button
```

or, for an app that would rather render its own link, `useFeedbackUrl()`
returns the URL and nothing else.

`@alepha/sigil/react` is a subpath of its own so that importing the module
never pulls React into an app that has none, and so a server-rendered host
resolves the component on the server pass as well as in the browser bundle.

## Error grouping

Errors are aggregated by fingerprint before they leave the process, with stack
frames normalized so that bundle hashes and `:line:column` do not split one
fault into a new group on every deploy. What reaches the sink is a count per
fingerprint, not one payload per occurrence — which is what keeps storage bound
by how many distinct faults exist rather than by how much traffic you have.
