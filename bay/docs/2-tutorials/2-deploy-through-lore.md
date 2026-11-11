# Deploy through Lore

The server from [Your first app on a VPS](/bay/docs/tutorials-first-app-on-a-vps),
driven from [Lore](/lore/docs/guides-introduction) instead of over SSH: Lore
holds the copy of your app, deploys it to the machine, and collects its page
views, Web Vitals and errors.

The machine connects **out** to Lore and holds a websocket open, so no port
opens on it and no SSH access is handed to anyone. SSH keeps working beside it.

You need a Lore account with a project you can deploy from, and everything the
first tutorial asks for.

## 1. Create the app and set up the server

Follow steps 1 to 4 of [Your first app on a VPS](/bay/docs/tutorials-first-app-on-a-vps):
create the app, pick a base domain, install Bay and run it as a service. Step 5,
the deploy user, is not needed: Lore drives Bay through its connector.

## 2. Link the app to a Lore project

**Local**, in the app's folder:

```bash
npm install @alepha/lore
npx lore login
npx lore project create myapp
```

`project create` writes `.alepha/lore.json`, so the commands that follow know
the project. For an existing project, `npx lore project link <slug>` does the
same.

A new project can deploy but does not collect telemetry yet: turn on **Track
apps** under **Settings → General → Capabilities**, in the **Deploy and watch
apps** capability.

## 3. Enrol the server as an estate

An **estate** is a machine that belongs to a project, which lends it to the
projects that deploy onto it. Run this in the project's directory, or pass
`-p <project>`, and the estate is created in that project and lent there.
**Local:**

```bash
npx lore estate add myvps --label "My VPS" --allow-deploys
```

It prints the command to run on the machine, with a secret shown **once**.
**Server**, as root, adding the data root and the socket of the service from
the first tutorial:

```bash
bay connector set https://lore.alepha.dev est_...
bay connector show
```

Clear that line from the shell history: it carries the secret. Back **local**,
the estate shows as connected:

```bash
npx lore estate list
```

[Lore connector](/bay/docs/guides-lore-connector) covers what the machine
reports and the commands Lore may send it.

## 4. Turn telemetry on

Register the sigil module in **both** entry files, `src/main.server.ts` and
`src/main.browser.ts`: the server half reports errors and forwards what the
browser half collects (page views, Web Vitals, errors in the page).

```typescript
import { AlephaSigil } from "@alepha/lore/sigil";

alepha.with(AlephaSigil);
```

Nothing else: the build declares that it reports, and the first deploy creates
the copy's key (`SIGIL_KEY`) and stores it in the copy's environment.

## 5. Deploy

**Local:** in `alepha.config.ts`:

```typescript
import { lore } from "@alepha/lore/cli";
import { defineConfig } from "alepha/cli/config";
import { infra } from "alepha/cli/infra";

export default defineConfig({
  plugins: [
    infra({
      environments: {
        production: lore({ project: "myapp" }),
      },
    }),
  ],
});
```

```bash
npx alepha deploy --env production
```

The first deploy creates the copy `myapp/production` in Lore, on the estate lent
to the project. It then builds what the estate runs, pushes the build to Lore,
seals the local secrets into the copy, and deploys, following the run in the
terminal until the machine reports done. The app answers at
`https://myapp.<base-domain>`:

```bash
curl https://myapp.apps.example.com/version
```

Later deploys reuse the copy. `npx lore deploy -e production` does the same from
the Lore CLI, and `--tag` deploys a stored build without building:
[Deploying an app](/lore/docs/guides-deploying).

## 6. Watch it

**Local:**

```bash
npx lore deploy status -e production
npx lore insights read
npx lore blight list
```

`insights read` gives page views, unique visitors, Web Vitals and the error
budget; `blight list` gives the app's failures, one row per root cause. The
same is on the project's **Apps** and **Blights** pages, with the server's CPU
and memory on the estate's page. [Telemetry](/lore/docs/guides-telemetry)
explains each number.

The app's server sends what it collected when a new event arrives at least ten
seconds after the oldest one it holds, with no timer: on an app nobody visits
yet, the first numbers appear with the next visits, not at once.

To go back to an earlier release, use **Roll back** on the copy's Deploy tab, or
`npx lore deploy rollback -e production`.

## 7. Take it down

1. **Remove the app from the server**, through Lore. Bay stops serving it and
   forgets it; its data stays on the server:

   ```bash
   npx lore apps destroy -e production --confirm myapp/production
   ```

   To delete its data too, run `bay remove <name>/production --purge` on the
   server **instead**: Lore never asks a machine to delete data.
   `npx lore apps destroy -e production --confirm myapp/production --purge`
   prints the exact command.

2. **Forget the copy in Lore.** This deletes its key and everything it reported,
   and Lore refuses it while the server still runs the copy:

   ```bash
   npx lore apps instance delete --app myapp -e production --yes
   ```

3. In Lore, delete the estate from its page under **Account → Estates**, or
   with `npx lore estate delete <slug> --yes`.
4. Delete the server with your provider, which is what stops the bill.

## Next

- [Stacks](/bay/docs/guides-stacks): a database or a queue deployed beside the
  app, from Lore.
- [Estates](/lore/docs/guides-estates): lending one machine to several projects.
- [A throwaway server, from a shell](/bay/docs/tutorials-a-throwaway-server): the
  same loop with no web page, for a server bought for an hour.
