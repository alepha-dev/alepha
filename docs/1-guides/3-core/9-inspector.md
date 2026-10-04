# Inspector

Every app `alepha dev` runs can be inspected from outside: its actions, jobs,
entities, atoms, environment and logs, read and edited by a separate tool. The
devtools app (`npx @alepha/devtools`) is one such tool. `alepha/inspector` is
the protocol underneath it, and nothing stops you from writing another: a
script, a TUI, an MCP server for an agent.

> ⚠️ **No stability promise before alepha 1.0.** The protocol carries a version
> number and a client refuses a run that speaks another one, but routes and
> fields may change in any release until then.

## How an app becomes inspectable

No app imports the inspector. `alepha dev` injects it into the app it serves,
and it registers in development only: never under test, never in production,
unless `ALEPHA_INSPECT=1` asks for it explicitly.

Once the app is ready, it announces itself in the run registry:

```text
~/.alepha/run/
  k3x9q2mf.json   the entry: name, cwd, git root, pid, mode, versions, log file
  k3x9q2mf.sock   the socket the inspector serves on, mode 0600
```

Each process gets a random run id, so two apps (or two containers, both pid 1)
never collide. The entry goes away when the app stops. `ALEPHA_RUN_DIR` moves
the directory, for tests, sandboxes or a Docker bind mount.

The inspector speaks HTTP over that Unix socket, never on the app's own port:
nothing is reachable from the network, and only the socket's owner can connect.
You can try it with curl:

```bash
curl --unix-socket ~/.alepha/run/k3x9q2mf.sock http://localhost/metadata
```

## Finding the apps

`InspectorClient` is the client side. It has no side effects of its own, so a
tool injects it alone, without the inspector:

```typescript check
import { Alepha } from "alepha";
import { InspectorClient } from "alepha/inspector";

const alepha = Alepha.create();
const client = alepha.inject(InspectorClient);

const list = async () => {
  for (const run of await client.discover()) {
    console.log(run.name, run.status, run.cwd);
  }
};
```

`discover()` returns every live run, and the last dead run of each app while
its log file exists. A run is live when its socket accepts a connection. A
crashed app stays listed as `dead` so its logs can still be read; the next run
of the same app replaces it.

## Calling a run

`connect(run)` returns a connection whose `call()` takes a route by name. The
request and the response are typed from the inspector's own route table:

```typescript check
import { Alepha } from "alepha";
import { InspectorClient } from "alepha/inspector";

const client = Alepha.create().inject(InspectorClient);

const inspect = async () => {
  const [run] = await client.discover();
  const app = client.connect(run);

  const meta = await app.call("metadata");
  console.log(meta.system.alephaVersion, meta.actions.length);

  await app.call("updateAtom", {
    body: { name: "app.settings", value: { theme: "dark" } },
  });

  const page = await app.call("dbList", {
    params: { entity: "users" },
    query: { size: "10" },
  });
  console.log(page);
};
```

`connect()` throws when the run speaks another protocol version, naming both
and the devtools release that matches the run. A dead run refuses every call
except its logs.

## Following the logs

`tail()` is an async iterator over the run's log, oldest first. It polls the
same cursor the devtools UI uses, drains a burst page by page before waiting
again, and returns when the run goes away. Here is a whole tool: every error of
every running app, as it happens.

```typescript check
import { Alepha } from "alepha";
import { InspectorClient } from "alepha/inspector";

const client = Alepha.create().inject(InspectorClient);

const watchErrors = async () => {
  const runs = await client.discover();
  await Promise.all(
    runs
      .filter((run) => run.status === "live")
      .map(async (run) => {
        for await (const entry of client
          .connect(run)
          .tail({ level: "error" })) {
          console.log(`[${run.name}] ${entry.message}`);
        }
      }),
  );
};
```

On a dead run, `logs()` and `tail()` read the file the process left behind.

## Security

The inspector reads and mutates application state: database rows, atoms, job
triggers, and the environment, secrets included, in cleartext. That is why it
lives on a `0600` socket in a `0700` directory rather than on a port, and why
it never registers in production unless asked to.
