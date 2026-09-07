# deploy-smoke

The smallest app that proves a **Lore deploy** provisioned real infrastructure:
one `$entity` (so the build declares `hasDatabase` and the deploy creates a D1
database) and one `$storage` (so it declares `hasBucket` and creates an R2
bucket). Each note writes a row and a blob together, and reads them back
separately, so a binding that is missing or empty fails visibly rather than at
some later feature.

## ⚠️ It has no `alepha.config.ts`, and that is the point

Every other example here declares its environments in a committed file and ships
with `alepha platform up`. This one declares nothing: the environment is a **row
in Lore**, the build target is resolved through the estate behind it, and
`APP_SECRET` and `PUBLIC_URL` are filled in by the deploy.

So the absence of that file is the assertion. If someone adds one to quiet a
tool, this app stops testing the thing it exists for.

```bash
lore artifacts push --tag smoke-1 --app deploy-smoke
lore apps deploy --env production --tag smoke-1
```

Both read `LORE_API_KEY` and `LORE_PROJECT` from the environment. See
[Deploying an app](../../../docs/lore/1-guides/6-deploying.md).
