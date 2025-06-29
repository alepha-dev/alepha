# alepha/bucket/azure

```ts
import { $bucket } from "alepha/bucket";
import { AlephaAzureBucket } from "alepha/bucket/azure";
import { Alepha, run } from "alepha";

class App {
	images = $bucket()
}

const alepha = Alepha.create( {
	env: {
		AZ_STORAGE_CONNECTION_STRING: "",
	},
})
	.with(AlephaAzureBucket)
	.with(App);

run(alepha);
```
