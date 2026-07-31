# @alepha/pulse-client

The reporting half of Pulse. Add it to an Alepha app and the app reports page
views, Web Vitals, client and server errors, and periodic server metrics to a
Pulse instance you name.

Named for the server it talks to, not for what it collects. The previous name
(`@alepha/telemetry`) suggested a generic collector you could point anywhere;
it is not — it speaks one protocol, to one kind of endpoint.

## Integration

```ts
import { AlephaPulse } from "@alepha/pulse-client";

alepha.with(AlephaPulse);
```

Then set two server-side variables:

| | |
|---|---|
| `PULSE_SINK` | origin of the Pulse instance, e.g. `https://pulse.example.com` |
| `PULSE_KEY` | per-app enrolment key issued by that instance — **secret, server-only** |

Both are optional, and their absence is a supported mode rather than a
misconfiguration: without a sink the module still captures, and aggregated
errors go to the logger instead. That is the headless case — an app that must
not phone home to anything.

Everything else about *how much* to collect comes from the sink at runtime, not
from env. A kill-switch that needs a redeploy is a kill-switch nobody reaches in
time.

## The browser never holds the key

The browser posts to `/api/pulse/ingest` on the app's own origin, and the app
forwards to the sink server-to-server. So the enrolment key stays on the
server, there is no CORS to configure, and no third-party origin appears in the
page.

Visitor identity is a daily-rotating hash salted with the request's own host —
no cookie, no local storage, nothing that follows a person between sites or
across days.

## No UI

The petition button used to be mounted here as a root component. It is now a
plain link the app renders wherever it likes, from `usePetitionUrl()`.

A reporting package that injects DOM is a reporting package that has to be
styled, translated and tested as a UI — for one button.

## Error grouping

Errors are aggregated by fingerprint before they leave the process, with stack
frames normalized so that bundle hashes and `:line:column` do not split one
fault into a new group on every deploy. What reaches the sink is a count per
fingerprint, not one payload per occurrence — which is what keeps storage bound
by how many distinct faults exist rather than by how much traffic you have.
