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
your project. Like the [app deploys](/lore/docs/apps-deploying) that ship it,
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

## From CI

`lore artifacts push` authenticates with an API key in the environment that
runs it:

```yaml
- run: |
    alepha build
    lore artifacts push --project acme --tag ${{ github.ref_name }}
  env:
    LORE_API_KEY: ${{ secrets.LORE_API_KEY }}
```

Create the key from your account settings: see
[Connecting an agent](/lore/docs/agents-connecting). `lore login` is the other
way to sign in, and not the one for CI: it needs a person to approve a code.

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
- An app instance's **Artifacts** tab lists that app's builds, one row per
  tag.
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

⚠️ This cannot be undone. The build leaves Lore with its stored bytes and
source maps. The deploy history keeps its records. Two deletes are allowed and
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

- [Deploying an app](/lore/docs/apps-deploying)
- [Releases](/lore/docs/work-releases)
- [Apps and instances](/lore/docs/apps-instances)
