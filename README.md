<div align="center">

<img src="assets/logo.png" alt="Logo" style="width: 256px"/>

<h1>Alepha</h1>

<p style="max-width: 512px">
🚧
</p>

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
