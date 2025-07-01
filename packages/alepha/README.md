<div align="center">
<img
  src="https://raw.githubusercontent.com/feunard/alepha/main/assets/logo.png"
  width="256"
  height="256"
  alt="Logo"
  style="width: 256px; height: 256px"
/>
<h1>Alepha</h1>
<p style="max-width: 512px">
🚧
</p>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/v/alepha.svg" alt="npm"/></a>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/l/alepha.svg" alt="npm"/></a>
<a href="https://codecov.io/gh/feunard/alepha"><img src="https://codecov.io/gh/feunard/alepha/graph/badge.svg?token=ZDLWI514CP" alt="npm"/></a>
<a href="https://www.npmjs.com/package/alepha"><img src="https://img.shields.io/npm/dt/alepha.svg" alt="npm"/></a>
<a href="https://github.com/feunard/alepha"><img src="https://img.shields.io/github/stars/feunard/alepha.svg?style=social" alt="GitHub stars"/></a>
</div>

## Installation

```bash
npm install alepha
```


## Usage

Minimalist http server with a single endpoint.

```ts
import { run } from "alepha";
import { $action } from "alepha/server";

class App {
  hello = $action({
    handler: () => "Hello world!",
  })
}

run(App);
```
