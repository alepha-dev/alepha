# Alepha Lore

Lore is the planning memory, telemetry sink and deploy chain for
[Alepha](https://github.com/alepha-dev/alepha) applications: quests, epics and
releases for the work, folios for the decisions, sigils for what a deployed app
reports, and estates for where it runs. It is built for AI agents first, over
MCP, and for the people working with them. It runs at
[lore.alepha.dev](https://lore.alepha.dev).

| Path                    | What                                                                 |
| ----------------------- | -------------------------------------------------------------------- |
| `apps/lore`             | The Lore app (Cloudflare Workers and D1, or a container with SQLite) |
| `packages/@alepha/lore` | `@alepha/lore` on npm: the `lore` CLI, the client and the sigil      |
| `apps/e2e-cli`          | End-to-end suites over built artefacts, Bay's included               |
| `.vendor`               | The Alepha framework, vendored from its `main`                       |

```bash
npm i -g @alepha/lore   # the CLI
lore login
```

Self-hosting: `docker run -p 3000:3000 -v lore:/data ghcr.io/alepha-dev/lore`.

MIT licensed.
