# alepha/bucket/azure

```ts
import { $bucket } from "alepha/bucket";
import { AzureBucketModule } from "alepha/bucket/azure";
import { Alepha, run } from "alepha";

class App {
	images = $bucket()
}

const alepha = Alepha.create( {
	env: {
		AZURE_STORAGE_CONNECTION_STRING: "",
	},
})
	// substitute DefaultBucketProvider with Azure if
	// - AZURE_STORAGE_CONNECTION_STRING is set
	// - not substituted by another provider (memory, local, s3, etc.)
	.with(AzureBucketModule)
	.with(App);

run(alepha);
```
