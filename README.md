<div align="center">
<h1>
<img
  src="framework/packages/alepha/assets/logo.svg"
  width="128"
  height="128"
  alt="Alepha logo"
  valign="middle"
/>
Alepha
</h1>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/v/alepha.svg" alt="npm version"/></a>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/l/alepha.svg" alt="license"/></a>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/dt/alepha.svg" alt="downloads"/></a>

<p><b>Full-stack TypeScript, from the first table to production.</b><br/>
Database, API, jobs and React with SSR in one framework. Your code never names its host,<br/>
so the same build ships to Cloudflare Workers or to a container on any machine.</p>

<a href="https://alepha.dev">Documentation</a> ·
<a href="https://alepha.dev/llms.txt">llms.txt</a> ·
<a href="https://alepha.dev/lore">Lore</a> ·
<a href="https://alepha.dev/bay">Bay</a>
</div>

```bash
npm create alepha my-app -- --infra cf
```

## A table, an API and a page

Typed end to end, no codegen.

```tsx
const views = $entity({
  name: "views",
  schema: z.object({ id: db.primaryKey(), createdAt: db.createdAt() }),
});

export class Api {
  views = $repository(views);

  inc = $action({
    method: "POST",
    path: "/inc",
    schema: { response: z.object({ count: z.number() }) },
    handler: async () => {
      await this.views.create({});
      return { count: await this.views.count() };
    },
  });
}

export class AppRouter {
  api = $client<Api>();

  home = $page({
    loader: () => this.api.inc(),
    component: (props) => <div>Views: {props.count}</div>,
  });
}
```

## Deploy anywhere

`npx alepha deploy` puts it on Cloudflare. `npx alepha image` puts the same build in a container, for any host that runs one. The code does not change; what sits underneath it does:

| Primitive     | On Cloudflare            | In Docker                                      |
| ------------- | ------------------------ | ---------------------------------------------- |
| `$repository` | D1                       | SQLite, or Postgres with `alepha/orm/postgres` |
| `$storage`    | R2                       | S3 (`S3_ENDPOINT`) or the local disk           |
| `$job`        | Queues and Cron Triggers | Redis (`REDIS_URL`) or in-process              |
| `$cache`      | Cache API or KV          | Redis (`REDIS_URL`) or memory                  |

Leaving is a flag, not a rewrite.

## Why Alepha

- **One build, any host.** Cloudflare's free tier today, your own server when the bill says so, or both.
- **Typed end to end.** The schema of a table types the API, the client and the page. Nothing to generate.
- **Batteries included.** ORM and migrations, jobs, cache, storage, auth, i18n and a UI kit, designed together.
- **Agent ready.** The whole API fits in [llms.txt](https://alepha.dev/llms.txt), for your coding agent.

## Start with your agent

<details>
<summary>A prompt for Claude Code, or any coding agent</summary>

```text
Read https://alepha.dev/llms.txt, then create an Alepha app in ./my-app with
`npm create alepha my-app -- --yes --infra cf`. Add a page that counts its views in the
database, run it with `npx alepha dev`, and tell me how to deploy it.
```

</details>

## Also in this repository

Two standalone products that work well with Alepha. Both are optional: an Alepha app needs neither.

### [Bay](bay/): a self-hosted app server

One static Go binary turns a VPS into a deploy target: an artifact goes in over SSH, an HTTPS URL comes out. Reverse proxy, TLS, supervision, rollback and backups included. No control port, no token.

```bash
curl -sSL https://alepha.dev/bay/install.sh | sudo sh
```

### [Lore](lore/): project memory for AI agents

Planning built for AI agents first, over MCP: quests and epics for the work, folios for the decisions, sigils for what a deployed app reports, estates for where it runs. Your agent knows why the code is the way it is. Lore is itself an Alepha app, running at [lore.alepha.dev](https://lore.alepha.dev).

```bash
npx @alepha/lore login
```

MIT licensed, see [LICENSE](LICENSE).
