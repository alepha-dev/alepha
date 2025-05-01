# @alepha/queue

Alepha Queue is a simple queue system for Alepha.

It provides a simple interface for creating and managing queues.

It uses Redis by default, but you can use any other queue provider by implementing the QueueProvider interface.

## Installation

```bash
npm install @alepha/queue
```

## Usage

```typescript
import { $queue, $consumer } from '@alepha/queue';

class App {
	sendNotification = $queue({
		schema: {
			payload: t.object({ id: t.uuid() }),
		}
	});

	worker = $consumer({
		queue: this.sendNotification,
		handler: async ({ payload }) => {
			console.log(payload.id);
		}
	});
}

run(App)
```
