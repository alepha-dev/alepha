# alepha/bucket/s3

```ts
import { $bucket } from "alepha/bucket";
import { S3BucketModule } from "alepha/bucket/s3";
import { Alepha, run } from "alepha";

class App {
	images = $bucket()
}

const alepha = Alepha.create( {
	env: {
		S3_URL: "",
	},
})
	.with(S3BucketModule)
	.with(App);

run(alepha);
```
