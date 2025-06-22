# alepha/bucket

```ts
import { $bucket } from 'alepha/bucket';
import { run } from 'alepha';

class App {
	images = $bucket({
		provider: 'local', // or 'memory'
		name: 'images',
		type: 'image',
		maxSize: 10 * 1024 * 1024, // 10 MB
		accept: ['image/png', 'image/jpeg', 'image/gif'],
	})
}

run(App);
```
