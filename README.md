# Alepha

Three products, one repository.

| Folder                     | What                                                                                    | Where                                          |
| -------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [`framework/`](framework/) | **Alepha**, the full-stack TypeScript framework: `alepha`, `@alepha/ui` and the rest     | [alepha.dev](https://alepha.dev), npm `alepha` |
| [`lore/`](lore/)           | **Lore**, the planning memory, telemetry sink and deploy chain for Alepha applications | [lore.alepha.dev](https://lore.alepha.dev)     |
| [`bay/`](bay/)             | **Bay**, the self-hosted application server for Alepha apps, in Go                     | [install](bay/INSTALL.md)                      |

```bash
npx alepha init my-app   # start an Alepha app
npm i -g @alepha/lore    # the lore CLI
```

## Working here

One `yarn install` at the root serves every product. Each product checks itself
from its own folder:

```bash
cd framework && yarn v
```

```bash
cd lore && yarn v
```

```bash
cd bay && go test ./...
```

CI runs per folder: a change under `framework/` runs the framework's checks and
Lore's (Lore builds on the framework's source), a change under `lore/` runs
Lore's, a change under `bay/` runs Bay's and Lore's (Lore's end-to-end suite
drives the real Bay).

MIT licensed, see [LICENSE](LICENSE).
