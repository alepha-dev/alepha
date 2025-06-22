# alepha/react/head

```ts
import { Alepha } from "alepha";
import { $page } from "alepha/react";
import { ReactHeadModule } from "alepha/react/head";

class App {
	root = $page({
		head: {
			title: 'My App',
		},
		component: () => "Hello, World!",
	})
}

const alepha = Alepha.create();

alepha
	.with(ReactHeadModule)
	.with(App);

run(alepha);
```
