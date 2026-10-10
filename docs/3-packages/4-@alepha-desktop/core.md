# @alepha/desktop - Core

Native macOS window for a compiled Alepha app: a webview shell, a supervised server Worker on loopback, and alepha compile --desktop.

## Installation

```bash
npm install @alepha/desktop
```

## Overview

A compiled Alepha app in a native macOS window.

```sh
alepha build --runtime bun
alepha compile --desktop --out myapp
```

The result is `dist/<Name>.app`: one executable whose main thread owns a
webview window, while the app's own server runs in a Bun Worker on an
ephemeral `127.0.0.1` port, reachable only by that window.

This entry is the protocol both sides of the Worker boundary speak
(`DesktopProtocol`). The Worker side is `@alepha/desktop/worker`.
