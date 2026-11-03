# Background Tasks

`alepha/background` runs a task without making the caller wait for it: a welcome
email, a webhook, a write that does not have to finish first. It is one call,
`defer()`, and it works the same on Node and on Cloudflare Workers.

```typescript check
import { BackgroundTaskProvider } from "alepha/background";
```

## Deferring a task

```typescript check
import { $inject } from "alepha";
import { BackgroundTaskProvider } from "alepha/background";
import { $action, okSchema } from "alepha/server";

class Signup {
  protected readonly background = $inject(BackgroundTaskProvider);

  register = $action({
    method: "POST",
    path: "/signup",
    schema: { response: okSchema },
    handler: async () => {
      this.background.defer(() => this.sendWelcomeEmail());
      return { ok: true };
    },
  });

  protected async sendWelcomeEmail() {
    console.log("sent");
  }
}
```

`defer()` returns immediately and the task starts on a microtask, at the handler's
next `await`, so often before the response is sent. A throw inside it never reaches
the handler. It shares the thread with everything else, so CPU work in a task still
blocks until it yields.

## What it does not do

A deferred task is a promise in this process. It has no record anywhere.

- **It is not retried.** A task that fails is logged as a warning and is gone.
- **It does not survive a crash.** A process that dies takes its running tasks
  with it.
- **It runs on this instance**, and nothing limits how many run at once.

For anything that has to happen, use a job.

| You need                                                    | Use                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------- |
| Work the response should not wait for, and that may be lost | `defer()`                                                     |
| Work that must happen, with retries                         | [`$job`](/docs/guides-features-background-jobs)               |
| Work on a schedule                                          | [`$job`](/docs/guides-features-background-jobs) with a `cron` |
| An event several listeners react to                         | [`$topic`](/docs/guides-realtime-topics)                      |

## Runtimes

| Runtime            | What keeps the task alive                                                          |
| ------------------ | ---------------------------------------------------------------------------------- |
| Node, Bun          | The event loop.                                                                    |
| Cloudflare Workers | The request's `waitUntil`, because the isolate is frozen once the response is out. |

On Workers the build swaps in `WorkerdBackgroundTaskProvider`, and the call site
does not change.

⚠️ `waitUntil` belongs to one invocation, so on Workers call `defer()` inside its
async context, as a handler or a cron tick does. Outside one, the task still runs,
without the guarantee that the isolate waits for it.

## Stopping and testing

Tasks in flight are tracked. On `stop` the app waits for them, within the 8 seconds
it gives all its stop hooks, and past that it gives up. A task deferred by another
task during shutdown is not waited for. `flush()` waits for what is running at any
other time, and never rejects:

```typescript check
import { Alepha } from "alepha";
import { BackgroundTaskProvider } from "alepha/background";

const alepha = Alepha.create();
const background = alepha.inject(BackgroundTaskProvider);
await alepha.start();

let sent = false;
background.defer(async () => {
  sent = true;
});

await background.flush();
console.log(sent); // true
```
