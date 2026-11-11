# bench

A hello-world Alepha API, the same API written with Express, and two scripts to measure the first against the second.

## The two apps

`src/app.ts` is the Alepha API: `GET /ping`, `GET /api/hello`, `GET /api/users/:id`, `GET /api/users` (a 100-row list, about 7 KB) and `POST /api/users`. `src/main.ts` runs it on Node or Bun, `src/worker.ts` on workerd.

`express/main.js` answers the same routes and does the same job as Alepha's defaults, so the comparison is between equal work:

- zod validation of params, query and body, and of the response, with the same `trim().max(255)` rules as `z.text()`
- JSON body parsing
- the same four security headers as `ServerHelmetProvider`
- compression above 1 KiB, brotli at quality 4
- a request id held in `AsyncLocalStorage`, and an `AbortSignal` aborted on disconnect
- one JSON log line per request, written synchronously to stdout

A server-rendered page has its own pair in [`ssr/`](./ssr/README.md).

## `yarn bench`

Server CPU per request, Alepha against Express. Needs [`oha`](https://github.com/hatoo/oha) on the `PATH`.

```bash
yarn w bench bench
```

```bash
yarn w bench bench --endpoints user,create --pairs 5
```

```bash
yarn w bench bench --runtime bun
```

Requests per second measure the machine as much as the server whenever anything else runs on it. So both servers run side by side and each is loaded in turn, in bursts of `--requests` (20000), `--pairs` times per endpoint (7), with the order flipped on every pair. Each burst is read as the CPU µs the server itself spent per request (`scripts/cpu-preload.ts`), and the verdict is the median of the per-pair ratios. Every pair ratio is printed: when they all sit on the same side of 1, the verdict holds however loaded the machine was.

## `yarn smoke`

The same 15 requests asked of the app on Node, on Bun and on workerd (through Miniflare), and the answers compared: statuses, bodies and headers. A change to the request path should change none of them. The request id, and on workerd the compression headers and `content-length`, are left out: they differ by design. It exits 1 on a difference.

```bash
yarn w bench smoke
```

## `yarn cold`

Cold start CPU of an app on local workerd: what a fresh Worker spends to load (parse, module top level, creating services), then on one event. It takes the app to measure as its argument.

```bash
yarn w bench cold ../../../lore/apps/lore
```

```bash
yarn w bench cold ../examples/shop --events api,page --rounds 9
```

```bash
yarn w bench cold ../../../lore/apps/lore --variant list --variant eager=ALEPHA_EAGER=true
```

Each sample is a fresh `wrangler dev --local` (the repository's wrangler, never a global one), with a local D1, an R2 bucket and the jobs queue bound the way a deploy binds them, and one event: a cron tick (`cron`), `GET /api/_links` (`api`) or `GET /` (`page`). The CPU of the workerd processes is read at ready and after the event (`proc_pid_rusage` on macOS, `/proc/<pid>/schedstat` on Linux), and an empty Worker's reading is subtracted. A warm-up run per variant applies the migrations first, so no measured event pays for them.

A variant is a build and an environment, `name[=dist][,KEY=VALUE...]`, the dist directory relative to the app. Without `--variant`, the build is compared with itself under `ALEPHA_EAGER=true`, which creates every class at boot. `--build` runs `alepha build --runtime workerd` first. Variants run interleaved, in a rotating order, and the low quartile of `--rounds` (7) is reported: a busy machine moves one run by tens of ms.

`--runtimes node,bun` measures load on a Node and on a Bun build instead: the CPU of the server process until it first answers `GET /health`.

It is a local tool, not a CI gate: the differences it is for are 10 to 100 ms, and CI runners are noisier than that.
