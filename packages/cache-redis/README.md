# alepha/cache/redis

```ts
import { $cache } from 'alepha/cache';
import { AlephaRedisCache } from 'alepha/cache/redis';
import { run } from 'alepha';

class App {
	cache = $cache<string>();
}

const alepha = App.create({
	env: {
		REDIS_URL: 'redis://localhost:6379',
	},
});

alepha
	.with(AlephaRedisCache)
	.with(App);

run(alepha);
```
