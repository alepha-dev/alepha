<div align="center">

<img src="packages/alepha/assets/logo.png" alt="Logo" style="width: 256px"/>

<h1>Alepha</h1>

<p style="max-width: 512px">
🚧
</p>

</div>

[![npm](https://img.shields.io/npm/v/alepha.svg)](https://www.npmjs.com/package/alepha)
[![license](https://img.shields.io/npm/l/alepha.svg)](https://www.npmjs.com/package/alepha)
[![downloads](https://img.shields.io/npm/dt/alepha.svg)](https://www.npmjs.com/package/alepha)

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
