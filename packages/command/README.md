# alepha/command

```ts
import { $command } from "alepha/command";
import { App } from "./App";

class App {
	migrate = $command({
		when: ["--migrate"],
		description: "Run database migrations",
		async handler() {

		},
	})
}

run(App);
```
