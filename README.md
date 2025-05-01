<div align="center">

<img src="assets/logo.png" alt="Logo" style="width: 256px"/>

<h1>Alepha</h1>
<hr/>

<h5>You probably don't need this.</h5>

</div>

## Installation

```bash
yarn add alepha
```

## Usage

```ts
// src/index.ts
import { run } from "alepha";
import { $action } from "alepha/server";

class App {
  hello = $action({
    handler: () => "Hello world!",
  })
}

run(App);
```
