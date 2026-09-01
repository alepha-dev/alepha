# Alepha @alepha/lore

The Lore client for Alepha apps: the sigil reporter, and the CLI that talks to a Lore instance.

## Installation

Part of the Alepha framework, published on its own:

```bash
npm install @alepha/lore
```

Everything an Alepha app needs to talk to [Lore](https://lore.alepha.dev), in two
subpaths that no host installs for the same reason.

|                      |                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `@alepha/lore/sigil` | the reporting half. A running app pushes page views, Web Vitals and errors to a sink.     |
| `@alepha/lore/cli`   | the command half. A build or a CI job pushes a record of what it produced into a project. |

The package is not part of the framework, and that is deliberate: Lore is a
superset of Alepha, so no Lore code belongs inside `alepha` itself. Both halves
live together because they share one answer to "where is Lore, and how do I
authenticate to it".

⚠️ The `SIGIL_*` variables below are unchanged by the rename. They name the
concept, not the package: a sigil is still a sigil inside Lore, and a deployed
app keeps reporting across the upgrade.

## Integration

```ts
import { AlephaSigil } from "@alepha/lore/sigil";

alepha.with(AlephaSigil);
```

Then set one server-side variable:

```
SIGIL_KEY=sg_my-project_…
```

That is the whole enrolment. The key is the only secret and the only required
variable: it authorises the reporting _and_ names the project reported into, so
there is nothing else for the app to be told.

Its absence is a supported mode rather than a misconfiguration. Without a key
the module still captures, and aggregated errors go to the app's own logger
instead. That is the headless case: an app that must not phone home to
anything.

### The optional three

|                |                                                                                  |
| -------------- | -------------------------------------------------------------------------------- |
| `SIGIL_SINK`   | origin of the sink. Defaults to `https://lore.alepha.dev`; set it to self-host.  |
| `SIGIL_CONFIG` | JSON object of switches over what to collect. Every field optional.              |
| `SIGIL_SALT`   | overrides the secret salting the daily visitor hash. Falls back to `APP_SECRET`. |

`SIGIL_CONFIG` turns things off, with one exception:

```
SIGIL_CONFIG={"vitals":false,"feedbackButton":"hidden"}
```

Fields: `analytics`, `blights`, `vitals`, `feedback` (booleans, all default
true), `feedbackButton` (a corner, or `hidden`), and
`feedbackButtonExcludedPaths` (path globs the button stays off).

The exception is `reportOutsideProduction` (default `false`), which turns
something **on**. Both halves are production-only: a key is a credential, not
permission to report from a laptop, and without the gate every `alepha dev`
session counted as traffic on the project's dashboard. A staging deployment
proving its enrolment sets `{"reportOutsideProduction":true}`, which turns the
server half on and says so at boot. The browser half does not read it.

It is deliberately an environment variable rather than something fetched from
the sink. A config fetched at runtime cannot survive a serverless isolate, which
discards the cache between requests and so pays the round trip in front of the
first byte of every cold page, and it cannot survive a prerender, which bakes
the answer into HTML at build time and leaves you with a kill-switch that needs
a redeploy.

### The app tells the sink what it resolved

The flip side of not fetching: the sink knows what it RECEIVES and nothing about
what the app DECIDED, so an app quietly sending nothing and a sink quietly
refusing it look identical from the sink's side. Every delivered batch therefore
carries a `config` field holding the **resolved** configuration - after defaults,
so an app that sets nothing still reports a full answer.

It is a claim, not a fact. Anyone holding a sigil token can put anything there,
so a sink must treat it as something to display beside its own record of what it
accepts, never as an input to a gate. Shown side by side, "this app is sending
vitals and the sink is refusing them" becomes visible instead of silent.

Optional in both directions: an older client sends nothing, and that reads as
"has not told us" rather than as off.

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
import { useFeedbackUrl } from "@alepha/lore/sigil";
```

`useFeedbackUrl()` returns the URL and nothing else, and `<SigilRoot />` hides
itself when there is none, so the two never fight.

## Error grouping

Errors are aggregated by fingerprint before they leave the process, with stack
frames normalized so that bundle hashes and `:line:column` do not split one
fault into a new group on every deploy. What reaches the sink is a count per
fingerprint, not one payload per occurrence, which is what keeps storage bound
by how many distinct faults exist rather than by how much traffic you have.

## The CLI half

`@alepha/lore/cli` is what a pipeline runs, and it registers from
`alepha.config.ts` the way any other CLI plugin does:

```ts
import { lore } from "@alepha/lore/cli";

export default defineConfig({
  plugins: [lore({ project: "alepha" })],
});
```

Config carries the project, `LORE_API_KEY` carries the secret, and `--project`
overrides the config for one invocation. No credential ever lands in a committed
file.

```bash
alepha lore login                          # sign this machine in
alepha lore quality push                   # coverage and test totals
alepha lore artifacts push --tag 1.2.3     # the build itself
```

### Which credential, in which order

1. `LORE_API_KEY`, which is what CI has.
2. A device-flow token cached for this hostname, which is what a laptop has
   after `alepha lore login`.
3. An error naming both.

⚠️ **Nothing ever starts a login on its own.** There is no human on a CI runner
to approve a device code, so a job that fell into that flow would poll until it
timed out and then fail for a reason its log does not explain. A missing
credential is a fast error instead, and `alepha lore login` refuses to run in CI
at all.

The key wins over a cached token on purpose: a machine holding both is a laptop
with a key exported for a one-off, and the explicit thing somebody just typed
should be the one that is used.

### `login` and `logout`

`login` runs the OAuth 2.0 device flow (RFC 8628): it prints a code and a URL,
you approve it in a browser, and the token is cached under
`~/.alepha/credentials.json`.

Tokens are kept **per hostname**, so a self-hosted instance named by `LORE_URL`
gets its own entry - a token minted by one is worthless to the other, and
sending it would hand a credential to a host that was never meant to see it.
`logout` forgets one hostname, and says so when there was nothing to forget.

⚠️ The credentials **directory** is created `0700`. The file itself takes
whatever the umask allows, so the directory is what protects it, the same way
`~/.ssh` does.

### `artifacts push`

Packs the current build and stores it in the project's registry, addressed by
sha256.

It packs for you. `alepha pack` stays for anyone who wants the file, but
requiring it as a separate step means the tarball on disk and the build in
`dist/` can differ, and the push would happily ship the older one - a stale
artifact that deploys cleanly and runs the wrong code.

| flag        |                                                                           |
| ----------- | ------------------------------------------------------------------------- |
| `--tag`     | Version this build is named by. Defaults to `latest`.                     |
| `--app`     | What it is filed under. Defaults to the slugified `name` in package.json. |
| `--force`   | Move a pinned tag that already holds different bytes.                     |
| `--project` | Override the project for this invocation.                                 |

⚠️ **There is no `--runtime`, and there never will be.** Lore reads it from the
artifact's own `dist/manifest.json`. A flag would eventually disagree with the
manifest, and the manifest is the artifact's own claim about itself. It is also
why nothing parses the filename: `1.2.3` names one release that may carry a
workerd build and a node build, and both land under that one tag.

`latest` is the only tag whose bytes may change. Pushing it replaces it in
place, which is the whole retention policy - one row and one stored object, no
sweep job. Every other tag is write-once; `--force` exists for "tagged the wrong
commit".

The digest is printed on success, and written to `$GITHUB_OUTPUT` when GitHub
Actions provides one. A tag can be moved by another job and a digest cannot, so
a later step meaning to deploy exactly these bytes should read the second.

A push that cannot happen exits non-zero. There is no `--soft`: the safety
belongs where the command runs, and the CI step that runs it gates no deploy.
