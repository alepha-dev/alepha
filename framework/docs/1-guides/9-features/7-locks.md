# Locks

`$lock` is a middleware that lets one caller at a time run a handler. It takes a
lock before the handler and releases it after, whether the handler returned or
threw. Over Redis the lock holds across every instance of the app.

```typescript check
import { $lock } from "alepha/lock";
```

## Guarding a handler

Put it in the `use` array of an `$action`, a `$job`, a `$page` or a `$pipeline`:

```typescript check
import { $lock } from "alepha/lock";
import { $action } from "alepha/server";

class Payouts {
  run = $action({
    method: "POST",
    path: "/payouts/run",
    use: [$lock({ name: "payouts" })],
    handler: async () => {
      // only one caller runs this at a time
    },
  });
}
```

`name` can also be a function of the handler's arguments, to lock one resource
rather than the whole handler. `name` is required: a middleware has no property
key to fall back on.

```typescript check
import { $pipeline } from "alepha";
import { $lock } from "alepha/lock";

class Accounts {
  recompute = $pipeline({
    use: [$lock({ name: (id: string) => `account:${id}` })],
    handler: async (id: string) => {
      console.log("recomputing", id);
    },
  });
}
```

## Options

| Option        | Default          | What it does                                                        |
| ------------- | ---------------- | ------------------------------------------------------------------- |
| `name`        |                  | The lock's key: a string, or a function of the handler's arguments. |
| `wait`        | `false`          | Wait for the lock instead of failing at once.                       |
| `maxDuration` | `[5, "minutes"]` | How long the lock can be held before it expires by itself.          |

## When the lock is taken

Without `wait`, a call that finds the lock held throws `LockAcquireError`.

With `wait: true`, it tries again every 500 milliseconds for up to `maxDuration`,
then throws the same error.

`LockAcquireError` carries no HTTP status, so in an `$action` it answers a 500. The
handler cannot catch it, since the middleware throws before the handler runs, and
an action's [`errors`](/docs/guides-server-typed-errors) cover the handler alone. If
a held lock is a normal outcome for that caller, put a
[middleware](/docs/guides-core-pipelines) of your own before `$lock` in `use`: the
first one is the outermost, so it can catch the error.

## How long a lock lasts

⚠️ **`maxDuration` is not a timeout on your handler.** The lock expires, the
handler keeps running, and the next caller gets in. Set it above the longest run
you expect.

The lock then protects what comes after: on release, a holder deletes the lock
only if it still owns it, so a handler that outlived `maxDuration` cannot release
the next holder's lock.

An expired lock is also what frees a key after a crash: an instance that dies
holding one blocks others for at most `maxDuration`.

## Providers

| Provider             | Selected                | Reach           |
| -------------------- | ----------------------- | --------------- |
| `MemoryLockProvider` | by default              | This process.   |
| `RedisLockProvider`  | when `REDIS_URL` is set | Every instance. |

⚠️ **Without `REDIS_URL`, a lock only excludes callers in the same process.** Two
instances both enter, and nothing warns you. The same applies to Cloudflare
Workers, where a lock is memory only, per isolate. A substitution of your own for
`LockProvider` wins over both defaults.

## Cron jobs

A `$job` with a `cron` already takes a lock around each tick, so with `REDIS_URL`
set one instance runs it, and without it every replica does. If taking that lock
fails, the tick runs anyway. Its `lock` option is `true` by default, and it has no
effect on queue or direct jobs, which rely on claiming a row instead. See
[Background jobs](/docs/guides-features-background-jobs).

## Hooks

| Hook             | Fires when                                                     | Payload                       |
| ---------------- | -------------------------------------------------------------- | ----------------------------- |
| `lock:acquired`  | A caller takes the lock.                                       | `name`, `id`, `maxDurationMs` |
| `lock:released`  | The handler finished or threw.                                 | `name`, `id`, `heldMs`        |
| `lock:contended` | A caller found it held, whether or not it gets the lock later. | `name`, `id`                  |
