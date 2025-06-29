# alepha/queue/redis

```ts
import { $queue } from 'alepha/queue';
import { run } from 'alepha';

class App {
	q = $queue();
}

const alepha = App.create({
	env: {
		REDIS_URL: 'redis://localhost:6379',
	},
});

alepha
	.with(AlepheRedisQueue)
	.with(App);

run(alepha);
```
