import { cpus } from "node:os";
import { MessageChannel, type MessagePort, Worker } from "node:worker_threads";
import { createDescriptor, Descriptor, KIND, TypeBoxValue } from "@alepha/core";
import type { TSchema } from "@sinclair/typebox";

/**
 *
 */
export const $thread = (options: ThreadDescriptorOptions): ThreadDescriptor => {
	return createDescriptor(ThreadDescriptor, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface ThreadDescriptorOptions {
	name?: string;
	handler: () => any | Promise<any>;
	maxPoolSize?: number;
	idleTimeout?: number;
}

// ---------------------------------------------------------------------------------------------------------------------

export class ThreadDescriptor extends Descriptor<ThreadDescriptorOptions> {
	protected readonly script = process.argv[1];
	private static readonly globalPool = new Map<string, ThreadPool>();

	public get name(): string {
		return this.options.name || this.config.propertyKey;
	}

	public get maxPoolSize(): number {
		return this.options.maxPoolSize || cpus().length * 2;
	}

	public get idleTimeout(): number {
		return this.options.idleTimeout || 60000; // 1 minute default
	}

	private getPool(): ThreadPool {
		if (!ThreadDescriptor.globalPool.has(this.name)) {
			ThreadDescriptor.globalPool.set(
				this.name,
				new ThreadPool(
					this.name,
					this.maxPoolSize,
					this.idleTimeout,
					this.script,
				),
			);
		}
		return ThreadDescriptor.globalPool.get(this.name)!;
	}

	public async execute<T = any>(data?: any, schema?: TSchema): Promise<T> {
		if (schema && data) {
			try {
				TypeBoxValue.Decode(schema, data);
			} catch (error) {
				throw new Error(
					`Invalid data: ${error instanceof Error ? error.message : error}`,
				);
			}
		}

		const pool = this.getPool();
		return await pool.execute<T>(data);
	}

	public async create(): Promise<void> {
		const pool = this.getPool();
		await pool.warmUp();
	}

	public async terminate(): Promise<void> {
		const pool = this.getPool();
		await pool.terminate();
		ThreadDescriptor.globalPool.delete(this.name);
	}
}

$thread[KIND] = ThreadDescriptor;

// ---------------------------------------------------------------------------------------------------------------------

interface ThreadMessage<T = any> {
	id: string;
	type: "execute" | "response" | "error";
	data?: T;
	error?: string;
}

interface ThreadInstance {
	worker: Worker;
	port: MessagePort;
	busy: boolean;
	lastUsed: number;
	pendingMessages: Map<
		string,
		{ resolve: (value: any) => void; reject: (error: Error) => void }
	>;
}

class ThreadPool {
	private instances: ThreadInstance[] = [];
	private queue: Array<{
		data: any;
		resolve: (value: any) => void;
		reject: (error: Error) => void;
	}> = [];
	private idleTimer?: NodeJS.Timeout;

	constructor(
		private readonly name: string,
		private readonly maxPoolSize: number,
		private readonly idleTimeout: number,
		private readonly script: string,
	) {}

	async warmUp(): Promise<void> {
		if (this.instances.length === 0) {
			await this.createInstance();
		}
	}

	private async createInstance(): Promise<ThreadInstance> {
		const { port1, port2 } = new MessageChannel();

		const worker = new Worker(this.script, {
			env: {
				...process.env,
				ALEPHA_WORKER: this.name,
				APP_NAME: "WORKER",
			},
			workerData: { port: port2 },
			transferList: [port2],
		});

		const instance: ThreadInstance = {
			worker,
			port: port1,
			busy: false,
			lastUsed: Date.now(),
			pendingMessages: new Map(),
		};

		instance.port.on("message", (message: ThreadMessage) => {
			if (message.type === "response" || message.type === "error") {
				const pending = instance.pendingMessages.get(message.id);
				if (pending) {
					instance.pendingMessages.delete(message.id);
					instance.busy = false;
					instance.lastUsed = Date.now();

					if (message.type === "error") {
						pending.reject(new Error(message.error));
					} else {
						pending.resolve(message.data);
					}

					this.processQueue();
				}
			}
		});

		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error("Thread initialization timeout")),
				5000,
			);

			worker.once("online", () => {
				clearTimeout(timeout);
				resolve();
			});

			worker.once("error", (error) => {
				clearTimeout(timeout);
				reject(error);
			});
		});

		this.instances.push(instance);
		this.resetIdleTimer();

		return instance;
	}

	async execute<T = any>(data?: any): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			this.queue.push({ data, resolve, reject });
			this.processQueue();
		});
	}

	private async processQueue(): Promise<void> {
		if (this.queue.length === 0) {
			return;
		}

		let instance = this.instances.find((i) => !i.busy);

		if (!instance && this.instances.length < this.maxPoolSize) {
			try {
				instance = await this.createInstance();
			} catch (error) {
				const { reject } = this.queue.shift()!;
				reject(
					error instanceof Error
						? error
						: new Error("Failed to create thread instance"),
				);
				return;
			}
		}

		if (!instance) {
			return; // Wait for an instance to become available
		}

		const { data, resolve, reject } = this.queue.shift()!;
		const messageId = `${Date.now()}-${Math.random()}`;

		instance.busy = true;
		instance.pendingMessages.set(messageId, { resolve, reject });

		const message: ThreadMessage = {
			id: messageId,
			type: "execute",
			data,
		};

		instance.port.postMessage(message);
	}

	private resetIdleTimer(): void {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
		}

		this.idleTimer = setTimeout(() => {
			this.cleanupIdleInstances();
		}, this.idleTimeout);
	}

	private cleanupIdleInstances(): void {
		const now = Date.now();
		const instancesToRemove = this.instances.filter(
			(instance) =>
				!instance.busy && now - instance.lastUsed > this.idleTimeout,
		);

		for (const instance of instancesToRemove) {
			const index = this.instances.indexOf(instance);
			if (index > -1) {
				this.instances.splice(index, 1);
				instance.port.close();
				void instance.worker.terminate();
			}
		}

		if (this.instances.length > 0) {
			this.resetIdleTimer();
		}
	}

	async terminate(): Promise<void> {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
		}

		await Promise.all(
			this.instances.map(async (instance) => {
				instance.port.close();
				await instance.worker.terminate();
			}),
		);

		this.instances = [];
		this.queue = [];
	}
}

// ---------------------------------------------------------------------------------------------------------------------
