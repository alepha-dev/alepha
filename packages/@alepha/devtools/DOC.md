## What it is

A local web app that finds every Alepha app running on your machine and
inspects it: actions, pages, jobs, topics, caches, storages, realms and roles;
the database schema and its rows; environment and atoms; the dependency graph;
the email and SMS outbox; and a live log tail. It is a tool you run, never a
dependency of your app.

```bash
npx @alepha/devtools              # 127.0.0.1:3310, or the next free port
npx @alepha/devtools --port 4000  # a port of your choice
npx @alepha/devtools --no-open    # do not open the browser
```

## How it finds your apps

Every app `alepha dev` runs carries `alepha/inspector`: it announces itself in
`~/.alepha/run/` and serves the inspector over a Unix socket only you can
open. The devtools lists that directory, follows apps as they start, stop and
hot-reload, and talks to each one through its socket. Nothing is added to your
app, and nothing listens on its port.

A production build is inspectable when built with `alepha build --inspect`
and started with `ALEPHA_INSPECT=1`. See the
[Inspector guide](https://alepha.dev/docs/guides-core-inspector) for that,
for Docker, and for writing a tool of your own on the same protocol.

## Security

The devtools reads and writes your apps' state (database rows, atoms, jobs)
and shows their environment, secrets included. It listens on `127.0.0.1` only.
