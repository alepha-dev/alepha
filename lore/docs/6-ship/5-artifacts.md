# Artifacts

An **artifact** is a build of your app that Lore keeps. It is what the
**Artifacts** page lists, what a release shows as built, and what a deploy
ships.

A build comes from the machine that holds the source, your laptop or your CI,
never from the running app. So the page stays empty until somebody pushes one,
with two commands:

```bash
alepha build
lore artifacts push --tag 1.2.3
```

`alepha build` writes `dist/`. `lore artifacts push` packs it and uploads it to
your project. Like the [app deploys](/lore/docs/ship-deploying) that ship it,
a pushed build is the build of an app made with Alepha.

## Pushing a build

| Flag        | Default                                       | What it is                                 |
| ----------- | --------------------------------------------- | ------------------------------------------ |
| `--project` | `LORE_PROJECT`                                | The project slug, the one in your Lore URL |
| `--app`     | the slugified `name` from your `package.json` | The name the build is filed under          |
| `--tag`     | `latest`                                      | The version this build is named by         |
| `--force`   | off                                           | Move a pinned tag that already holds bytes |

`--project` and `--app` both have answers without you: the project from the
environment, the app from your `package.json` (or from `LORE_APP`). Pass them
when the defaults are wrong, which is most often a monorepo publishing several
apps from one pipeline.

Three things are worth knowing:

- **The push packs for you.** There is no separate packing step to forget, so
  what is uploaded is always the build now in `dist/`. `alepha pack` still
  exists for anyone who wants the file.
- **An artifact belongs to an app, not to a deployed copy of one.** Every
  environment of `checkout` lists the same builds. Which one runs where is the
  **Deploy** tab's question.
- **There is no `--runtime`.** Lore reads the runtime from the build itself,
  so a flag can never disagree with it. A tag can hold one build per runtime:
  `1.2.3` for Cloudflare and `1.2.3` for a Bay machine are two builds.

Beside the archive, the push sends the list of the build's static assets:
every file under `dist/public`, with its hash, size and content type. The
first deploy of that build is faster for it, most of all for a site of
thousands of files. Source maps, `.DS_Store` and `node_modules` are left out
of both. Lore keeps each list for the project that pushed it, and checks every
asset it uploads against it, so a wrong list cannot reach another project's
deploys. A build pushed without a list deploys normally.

## What a push records

Beside the build, a push records three things about the commit it came from:

- **The commit itself**, the one `git rev-parse HEAD` names.
- **The quests its history references.** Every `#Q12` in the subject or body
  of a commit in its history counts. Lore keeps that set once per commit, so
  every copy deployed from these bytes, by any route, knows which quests it
  runs: the **Live** chip on a quest and the "behind" count on a copy read it.
  A push only reads the commits since the last one Lore already knows, so
  after the first push it reads a handful.
- **Whether the working tree was dirty**: a file git tracks was modified.
  Untracked files, build output for one, never count. A copy deployed from a
  dirty build shows its quests as **live (unverified)**.

The push prints one line about it, for example
`12 quests referenced (complete, since 3f2a9c1b8e0d), clean`.

### A bare `#123`

Only `#Q123` counts by default. A project that writes quest numbers bare can
opt in, in `.alepha/lore.json` at the root of the repository:

```json
{ "project": "acme", "bareQuestRefs": true }
```

⚠️ Leave it off in a project that squash-merges pull requests on GitHub:
every merged subject ends with the pull request's number, `(#123)`, which
would count as quest 123.

### A repository holding several apps

A commit's history holds every quest, whichever app it was for. So in a
repository holding several apps, a quest for the `api` would show as live on
the `docs` too, as soon as the docs are deployed from a later commit.

Say which paths each app is built from, in the same file:

```json
{
  "project": "acme",
  "apps": {
    "docs": ["apps/docs", "packages/docs"],
    "web": ["apps/web", "packages", "yarn.lock"]
  }
}
```

A push of `docs` then also records the quests of the commits that changed
`apps/docs` or `packages/docs`, and a quest is **Live** on a copy of `docs`
only when one of its commits did. The push says so on a second line, for
example `3 of them touch the paths of docs (complete, since 3f2a9c1b8e0d)`.

- The key is the app's name, as the push files it. An app with no entry keeps
  the whole history.
- A path is a git pathspec read from the root of the repository, wherever the
  file sits: a folder (`apps/docs`), a file (`yarn.lock`), or a pattern
  (`:(glob)**/docs/**`).
- List what the app is built from, the shared packages included: a quest that
  only changed a package the `web` imports is live on the `web`.
- Each copy follows its paths from its next push on. A copy still running an
  older build shows the whole history until then.
- After the list changes, the next push reads the history again with the new
  paths.

"Behind" keeps counting every done quest merged since the copy's last
deployment, whatever it changed: which paths a commit changed is only known
once a build of it is pushed.

## From CI

`lore artifacts push` authenticates with an API key in the environment that
runs it. Check out the whole history, so the push can read which quests the
commit carries:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- run: |
    alepha build
    lore artifacts push --project acme --tag ${{ github.ref_name }}
  env:
    LORE_API_KEY: ${{ secrets.LORE_API_KEY }}
```

Create the key from your account settings: see
[Connecting an agent](/lore/docs/agents-connecting). `lore login` is the other
way to sign in, and not the one for CI: it needs a person to approve a code.

`actions/checkout` clones one commit by default. A push from that clone can
only name the quests of the commits it holds, unless Lore already knows the
commit before it, so it records a partial set and says so: copies running it
show the quests found, but never claim a quest is not live, or count what
they are behind. `fetch-depth: 0` fixes it; the push never fails over it.

A push that cannot happen exits non-zero. Put the step behind
`continue-on-error` if you would rather a failed push annotate the run than
block the release.

Pushing needs the `artifact:push` permission, which the default Member rank
holds.

## `latest` is the one tag that may be replaced

Every other tag is written once. Push `1.2.3` twice with different bytes and
the second one is refused, which is what makes a tag worth trusting: a release
attached to `1.2.3` names the same build tomorrow.

`--force` moves a pinned tag anyway. It exists for "tagged the wrong commit"
and for nothing else. If you find yourself reaching for it in a pipeline, the
tag you want is `latest`.

## Container images

When CI also pushes a container image to a registry, record it under the same
tag:

```bash
lore artifacts push-image --tag 1.2.3 --image ghcr.io/acme/web:1.2.3
```

Nothing is uploaded: Lore checks the image at the registry and keeps its
reference. The **Artifacts** page lists it with the format `image`, and the
build's page offers its `docker pull` command to copy. The **Deploy** tab
ships packed builds, not images. An image on `ghcr.io` is read anonymously.
Any other registry needs the project's credential first: see
[Container registries](/lore/docs/reference-cli#container-registries).

## Where builds appear

- The project's **Artifacts** page lists every build of every app. Search a
  tag or a commit, and filter by app, runtime or format. A row's menu
  downloads the archive.
- Opening a build shows what it needs, where it runs, its manifest and its
  deployments, with a **Deploy** menu when the project deploys through Lore.
  Its **Builds** tab lists the app's builds of the same runtime and format,
  each set against the one before it: the commit it was built from, how many
  variables and secrets it reads and by how many that moved (hover a count
  for the names), the resources it gained or lost, its runtimes and crons
  when they changed, and its size. A blank cell means the build's content is
  unknown, which is the case for an image.
- A release shows, on its **Artifacts** tab, the builds whose tag equals the
  release's tag. Nothing links the two, so changing the release's tag changes
  what it shows.
- An app instance's **Deploy** tab is the same list with a **Deploy** button
  per build.

## Deleting a build

A build pushed by mistake is removed from the project's **Artifacts** page:
tick rows and use **Delete** in the bar that appears, or use **Delete** in a
row's menu. It needs the `artifact:delete` permission, which the owner holds
and a [rank](/lore/docs/project-members) can be given. Pushing does not need
it.

⚠️ This cannot be undone. The build leaves Lore with its stored bytes. The
deploy history keeps its records. Two deletes are allowed and
named in the confirmation before they happen:

- **A build a deployed copy runs.** A redeploy or a rollback that needs it has
  nothing to deploy afterwards.
- **`latest`.** Deploys that name no tag fail until CI pushes it again.

## From an agent

An agent reads builds with `artifact_list` and `artifact_get`, and ships one
with `deploy_start`. Pushing has no tool: it needs the build on disk, so it is
the CLI's job. `lore artifacts list` and `lore artifacts get` read the same
from a shell. See [MCP tools](/lore/docs/reference-mcp-tools) and
[The lore CLI](/lore/docs/reference-cli).

## Next

- [Deploying an app](/lore/docs/ship-deploying)
- [Releases](/lore/docs/plan-releases)
- [Apps and instances](/lore/docs/ship-instances)
