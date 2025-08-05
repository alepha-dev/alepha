import { Worker } from "node:worker_threads";
import { createDescriptor, Descriptor, KIND } from "@alepha/core";

/**
 *
 */
export const $thread = (options: ThreadDescriptorOptions): ThreadDescriptor => {
	return createDescriptor(ThreadDescriptor, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface ThreadDescriptorOptions {
	name?: string;
	handler: () => void | Promise<void>;
}

// ---------------------------------------------------------------------------------------------------------------------

export class ThreadDescriptor extends Descriptor<ThreadDescriptorOptions> {
	protected readonly script = process.argv[1];

	public get name(): string {
		return this.options.name || this.config.propertyKey;
	}

	/**

-------------------------
1. Thread management
-------------------------

Thread must have 2 modes :
- spawn, work and exit
- spawn, and work forever (preferred)

-> Starting a thread with the whole Alepha context is slow (300ms)

A better strategy is to start the thread + context the first time, then reuse the thread + context.
If thread is not used for a while (1 minute ?), it can exit.

- start the thread
- emit a message to the thread (thread: this.name, data: { ... }) (note: use TypeBox to validate the data)
- wait for response from the thread (thread: this.name, data: { ... }), do not exit the thread !!
// ...
- if the thread is already started, just emit a message to the thread

-------------------------
2. Thread Max Pool Size
-------------------------

maxPoolSize: number = cpuCount * 2;

for 1 cpu:

.create(); // work for 10 seconds
.create(); // work for 10 seconds
.create(); <-- wait for the first thread to finish!

-------------------------
3. Dedicated Context
-------------------------

Alepha context can be heavy, we don't need to load 100 http handlers, 100 db connections, etc.
We must add a new feature :

class ServiceWorker { w = $thread() }

- alepha.state("target", ServiceWorker);
- when alepha.configure(), remove all services that are not in the target state
- re-use feature for $command() and $scheduler() for outside cron jobs

ServiceWorker will become the source of truth for the thread.
If you have 2 ServiceWorkers, we won't be able to reuse the thread.
If you don't use classes (aka alepha.use($thread, {}), each thread will have its own context.

	 */

	public async create() {
		await new Promise((resolve) => {
			const worker = new Worker(this.script, {
				env: {
					ALEPHA_WORKER: this.name,
					APP_NAME: "WORKER",
				},
			});
			worker.once("message", resolve);
			worker.once("error", resolve);
			worker.once("exit", (code) => {
				resolve(code);
			});
		});
	}
}

$thread[KIND] = ThreadDescriptor;

// ---------------------------------------------------------------------------------------------------------------------
