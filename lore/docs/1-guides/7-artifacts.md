# Pushing artifacts

An **artifact** is a build your CI hands to Lore and keeps. It is what the
Artifacts page lists, what a release attaches, and what a deploy ships.

Artifacts do not arrive from the running app. Everything else Lore knows about
an app is telemetry the app itself reports; an artifact comes from your
pipeline, which is a second system Lore cannot see. So an app with no CI
integration has telemetry and no artifacts, forever, and that is a normal
state rather than a fault.

## The two commands

```bash
alepha build
lore artifacts push --project <project> --app <app> --tag 1.2.3
```

`alepha build` writes `dist/`. `lore artifacts push` packs it and uploads it.

It packs for you on purpose. `alepha pack` still exists for anyone who wants
the file, but requiring it as a separate step means the tarball on disk and
the build in `dist/` can drift, and the push would ship the older one: a stale
artifact that deploys cleanly and runs the wrong code.

## The flags

| Flag        | Default                                       | What it is                                 |
| ----------- | --------------------------------------------- | ------------------------------------------ |
| `--project` | `LORE_PROJECT`                                | The project slug, the one in your Lore URL |
| `--app`     | the slugified `name` from your `package.json` | The name the build is filed under          |
| `--tag`     | `latest`                                      | The version this build is named by         |
| `--force`   | off                                           | Move a pinned tag that already holds bytes |

`--project` and `--app` both have answers without you: the project from the
environment, the app from your `package.json`. Pass them when the defaults are
wrong, which is most often a monorepo publishing several apps from one
pipeline.

An artifact belongs to an **app**, not to a deployed copy of one. Every
environment of `checkout` lists the same builds, and which one is running
where is the Deploy tab's question.

There is no `--runtime`. Lore reads it from the artifact's own
`dist/manifest.json`, because that is the build's own claim about itself and a
flag would eventually disagree with it.

## The credential

`lore artifacts push` authenticates with an API key in the environment that
runs it:

```yaml
- run: |
    alepha build
    lore artifacts push --project my-project --tag ${{ github.ref_name }}
  env:
    LORE_API_KEY: ${{ secrets.LORE_API_KEY }}
```

Mint the key from your account settings. `lore login` is the other way in and
is not the one to reach for here: it needs a human to approve a code, and CI
has none.

A push that cannot happen exits non-zero. Put the step behind
`continue-on-error` if you would rather a failed push annotate the run than
block the release: it gates no deploy either way.

## `latest` is the one tag that may be replaced

Every other tag is written once. Push `1.2.3` twice with different bytes and
the second one is refused, which is what makes a tag worth trusting: a release
attached to `1.2.3` names the same build tomorrow.

`--force` moves a pinned tag anyway. It exists for "tagged the wrong commit"
and for nothing else. If you find yourself reaching for it in a pipeline, the
tag you want is `latest`.

## What Lore does with them

- **Artifacts** on the project lists every build across every app, filterable
  by app and by tag.
- An app's own **Artifacts** tab lists that app's builds, one row per tag,
  with a row per runtime underneath when a tag carries more than one.
- A **release** shows the artifacts matching its tag. The match is on tag
  equality with no join table, so retagging a release changes what it shows.
- The **Deploy** tab is the same list with a ship button per row.
