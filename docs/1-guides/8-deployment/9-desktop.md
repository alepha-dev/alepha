# Desktop App (macOS)

`@alepha/desktop` turns a built Alepha app into a macOS application: `dist/<Name>.app`, one
executable whose main thread owns a native window while the app's own server, unchanged, runs in a
Bun Worker on a private loopback port that only that window can reach. The window loads the app
like a browser would, so `$page`, React, typed `$action` clients and SQLite all work as they do on
the web.

```bash
alepha build --runtime bun
alepha compile --desktop --out myapp   # dist/<Name>.app
```

It is the [single binary](/docs/guides-deployment-bare#single-binary) of `alepha compile`, wrapped in a window and
a bundle. It is not a build mode: `alepha build` produces the same `dist/` as always, and only
`compile --desktop` turns it into an app.

## Requirements

- A Mac, building for itself: macOS on the host, the host's own architecture as the target. There
  is no cross-compilation, and no Windows or Linux desktop build.
- Bun on the build machine, and Xcode's command line tools (`codesign`, `sips`, `iconutil`):
  `xcode-select --install`.
- `@alepha/desktop` in the app's dependencies. `alepha` does not depend on it; the flag resolves it
  from the app.

Tested on macOS 26.5, Apple Silicon (arm64), Bun 1.4.2, webview-bun 2.4.0. The app declares macOS
15.0 as its minimum, the deployment target of the embedded webview library; Intel Macs and macOS
15.x have not been tested.

## Declare the app

```typescript check
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  build: { runtime: ["bun"] },
  desktop: {
    name: "Notes",
    identifier: "com.example.notes",
    icon: "assets/icon.png",
    window: { width: 1280, height: 860 },
  },
});
```

| Key          | Meaning                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| `name`       | Display name, menu title and bundle name (`<name>.app`): letters, digits, spaces, `.`, `_`, `-`          |
| `identifier` | Reverse-DNS. Names the data and log folders, so changing it orphans what the app wrote under the old one |
| `icon`       | A PNG inside the project, converted to ICNS. A default icon is used otherwise                            |
| `window`     | `title` (default `name`), `width` (1200), `height` (800), `resizable` (true)                             |

`desktop` is read by `compile --desktop` and nothing else: declaring it changes neither `build`,
nor an ordinary `compile`, nor `image`. `--out` names the executable inside the bundle, not the
bundle.

## What compiling does

Every check runs first: the host, the target, the config, the bun slice, the package and the tools.
The work then happens in a staging copy of `dist/` (`node_modules/.alepha/desktop-stage`): the
public files are embedded, a shell, a supervisor and a server Worker entry are generated and
compiled together with `bun build --compile`, and the bundle is assembled and signed. Only a
finished bundle is moved into `dist/`, after which the inputs the binary now carries are removed,
as an ordinary compile does. A failure at any step leaves `dist/` exactly as the build wrote it, so
the command can simply be run again; a second compile needs a new build.

```
<Name>.app/Contents/
  Info.plist
  MacOS/<out>                     the executable: shell, server, public files, webview library
  Resources/app.icns
  Resources/migrations/           the project's migrations, read-only
  Resources/THIRD_PARTY_NOTICES.md
```

The bundle is ad hoc signed (`codesign --sign -`), executable first and bundle last, then verified.
That makes it run on the Mac that built it. It is not a Developer ID signature or a notarization: a
copy downloaded on another Mac meets Gatekeeper's checks for apps from unidentified developers, and
nothing here can promise how a given Mac treats it.

Measured on the fixture app (a React page, a typed action, SQLite): 62 MB bundle, 26 MB zipped,
about 0.4 s from launch to a painted page. Almost all of the size is the Bun runtime.

## Where the app reads and writes

| What              | Where                                                                    |
| ----------------- | ------------------------------------------------------------------------ |
| Working directory | `Contents/Resources`, whatever directory Finder or a shell launched from |
| Migrations        | `Contents/Resources/migrations`, read-only                               |
| SQLite database   | `~/Library/Application Support/<identifier>/app.db`                      |
| `APP_SECRET_FILE` | `~/Library/Application Support/<identifier>/secret`, generated, 0600     |
| Log               | `~/Library/Logs/<identifier>/app.log`, 0600, plus one `app.log.1`        |
| Instance lock     | `~/Library/Application Support/<identifier>/instance.lock`               |

- The data and log folders are created owner-only on first launch.
- The secret is the framework's own `APP_SECRET_FILE`: generated once, kept across launches. An
  `APP_SECRET` set anywhere wins, then an `APP_SECRET_FILE` set by the user.
- The database default applies only to the default SQLite connection, and only when the app names
  no database: an explicit `DATABASE_URL`, a Postgres or D1 URL, or a path given to the SQLite
  provider wins. A relative writable path (`sqlite://app.db`, a relative `APP_SECRET_FILE`) is
  refused at startup with the reason, rather than written into the read-only bundle.
- Everything the process prints (the shell, the server, the native layer) goes to the log, which
  rotates at 10 MiB. An app's own log destination keeps working.
- Only framework-managed data is placed for you. A file the app opens by a relative path resolves
  against `Contents/Resources`, which is read-only.

## The window

One window, one server, one running instance per identifier: a second launch shows "already
running" and exits before touching the secret or the database. The menu bar carries the app's
Quit (Cmd+Q) and an Edit menu (undo, redo, cut, copy, paste, select all). Closing the window,
Cmd+Q and the Dock's Quit all stop the server through the app's stop hooks, within 15 seconds;
only then does the process exit 0. A scripted `quit` reports "User canceled" even though the app
then exits: the app declines AppKit's immediate exit so that its stop hooks run first.

Startup has 30 seconds. A startup failure, a window that cannot open, or the server dying while the
window is open shows a native alert naming the log file, and the process exits nonzero (1 startup,
2 crash, 3 stop not graceful, 4 already running, 5 window). The alert shows the error's message,
never its stack.

## The private server

The server listens on `127.0.0.1` on a random port, chosen at each launch. An app that configures
another host or a fixed port fails to start with the reason: the desktop shell sets
`SERVER_HOST` and `SERVER_PORT` itself.

Every request, static files and unknown paths included, passes an admission check before the app
sees it:

- the `Host` header must be exactly `127.0.0.1:<port>`; forwarded headers are never read;
- the window's first URL carries a one-use capability, valid for 30 seconds, which the server
  exchanges for a random session in an `HttpOnly`, `SameSite=Strict` cookie and a redirect to `/`;
  the capability is never logged and never becomes the cookie;
- a request carrying an `Origin` must come from the server's own origin, and `Sec-Fetch-Site` must
  be `same-origin` or `none`, so a page on another loopback port holding a valid cookie is still
  refused;
- every other request needs the session cookie, else `403`.

This keeps out unsolicited requests from browsers and other local programs. It is not a defence
against code already running as the same macOS user, which can read the process itself.

Two consequences of a fresh random port per launch: browser storage tied to the origin
(`localStorage`, IndexedDB) does not survive a relaunch, and an external OAuth provider cannot be
registered with a fixed callback URL. Keep durable state on the server side, in the database.

## Not included

No Developer ID signing or notarization, no installer or updater, no tray icon, no second window,
no development mode in a window, and no bridge from the page to native APIs: the page talks to its
own server like any web page.
