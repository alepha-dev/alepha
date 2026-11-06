# bench-ssr

A server-rendered page in Alepha, the same page served by Express with `react-dom/server`, and the bench's paired measurement between the two.

## The two servers

`src/RowsRouter.ts` is a `$page` at `/`: a loader returning 100 users and `src/UserTable.ts`, a table of them. It is built with `alepha build` and runs from `dist/index.node.js`. The page is not cached (`cache: false`), so every request renders.

`express/main.js` serves the same document from the very same component module. `UserTable.ts` is written with `createElement` rather than JSX, so Node runs it unbuilt:

- `renderToPipeableStream`, streamed as soon as the shell is ready
- the same document around it: doctype, head with title and module script, the loader data as a JSON script for hydration
- the same headers: `no-store` caching, helmet's four, a `modulepreload` link
- compression above 1 KiB, brotli at quality 4
- a request id in `AsyncLocalStorage`, an `AbortSignal` aborted on disconnect, one JSON log line per request

Alepha's document is a little larger (about 20.0 KB against 19.8): it also writes a private state script and a view-transition attribute.

## `yarn bench`

Builds the Alepha app, then runs `../scripts/bench.ts` on the `page` endpoint: both servers side by side, CPU µs per request from each server's own `process.cpuUsage()`, alternating bursts, the median of the pair ratios. Needs [`oha`](https://github.com/hatoo/oha) on the `PATH`.

```bash
yarn w bench-ssr bench
```

Node only. On Bun, `renderToPipeableStream` goes through Bun's emulation of Node streams and the Express page costs over ten times what it costs on Node, which measures that emulation rather than Express.
