# alepha/queue

```ts
import { run } from '@alepha/core';
import { $queue, $consumer } from '@alepha/queue';

class App {
  q = $queue({
    schema: {
      payload: t.object({ id: t.uuid() }),
    }
  });

  worker = $consumer({
    queue: this.q,
    handler: async ({ payload }) => {
      console.log(payload.id);
    }
  });
}

run(App)
```
