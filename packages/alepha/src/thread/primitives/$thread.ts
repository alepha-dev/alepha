import { cpus } from "node:os";
import { MessageChannel, type MessagePort, Worker } from "node:worker_threads";
import type { TSchema } from "alepha";
import { createPrimitive, KIND, Primitive, TypeBoxValue } from "alepha";

/**
 * Creates a worker thread primitive for offloading CPU-intensive tasks to separate threads.
 *
 * This primitive enables you to run JavaScript code in Node.js worker threads, allowing you to
 * leverage multiple CPU cores and avoid blocking the main event loop. It provides a pool-based
 * approach with intelligent thread reuse and automatic lifecycle management.
 *
 * **Key Features**
 *
 * - **Thread Pool Management**: Automatically manages a pool of worker threads with configurable limits
 * - **Thread Reuse**: Reuses existing threads to avoid expensive initialization overhead
 * - **Idle Cleanup**: Automatically terminates unused threads after a configurable timeout
 * - **Type-Safe Communication**: Optional TypeBox schema validation for data passed to threads
 * - **CPU-Aware Defaults**: Pool size defaults to CPU count × 2 for optimal performance
 * - **Error Handling**: Proper error propagation and thread cleanup on failures
 *
 * **Use Cases**
 *
 * Perfect for CPU-intensive tasks that would otherwise block the main thread:
 * - Image/video processing
 * - Data transformation and analysis
 * - Cryptographic operations
 * - Heavy computations and algorithms
 * - Background data processing
 *
 * @example
 * **Basic thread usage:**
 * ```ts
 * import { $thread } from "alepha/thread";
 *
 * class DataProcessor {
 *   heavyComputation = $thread({
 *     name: "compute",
 *     handler: async () => {
 *       // This runs in a separate worker thread
 *       let result = 0;
 *       for (let i = 0; i < 1000000; i++) {
 *         result += Math.sqrt(i);
 *       }
 *       return { result, timestamp: Date.now() };
 *     }
 *   });
 *
 *   async processData() {
 *     // Execute in worker thread without blocking main thread
 *     const result = await this.heavyComputation.execute();
 *     console.log(`Computation result: ${result.result}`);
 *   }
 * }
 * ```
 *
 * @example
 * **Configured thread pool with custom settings:**
 * ```ts
 * class ImageProcessor {
 *   imageProcessor = $thread({
 *     name: "image-processing",
 *     maxPoolSize: 4,        // Limit to 4 concurrent threads
 *     idleTimeout: 30000,    // Clean up idle threads after 30 seconds
 *     handler: async () => {
 *       // CPU-intensive image processing logic
 *       return await processImageData();
 *     }
 *   });
 * }
 * ```
 *
 * @example
 * **Thread with data validation:**
 * ```ts
 * import { t } from "alepha";
 *
 * class CryptoService {
 *   encrypt = $thread({
 *     name: "encryption",
 *     handler: async () => {
 *       // Perform encryption operations
 *       return await encryptData();
 *     }
 *   });
 *
 *   async encryptSensitiveData(data: { text: string; key: string }) {
 *     // Validate input data before sending to thread
 *     const schema = t.object({
 *       text: t.text(),
 *       key: t.text()
 *     });
 *
 *     return await this.encrypt.execute(data, schema);
 *   }
 * }
 * ```
 *
 * @example
 * **Parallel processing with multiple threads:**
 * ```ts
 * class BatchProcessor {
 *   processor = $thread({
 *     name: "batch-worker",
 *     maxPoolSize: 8,  // Allow up to 8 concurrent workers
 *     handler: async () => {
 *       return await processBatchItem();
 *     }
 *   });
 *
 *   async processBatch(items: any[]) {
 *     // Process multiple items in parallel across different threads
 *     const promises = items.map(() => this.processor.execute());
 *     const results = await Promise.all(promises);
 *     return results;
 *   }
 * }
 * ```
 */
export const $thread = (options: ThreadPrimitiveOptions): ThreadPrimitive => {
  return createPrimitive(ThreadPrimitive, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface ThreadPrimitiveOptions {
  /**
   * Unique name for this thread worker.
   *
   * Used for:
   * - Thread pool identification (threads with same name share the same pool)
   * - Logging and debugging
   * - Error messages and stack traces
   *
   * If not provided, defaults to the property key of the primitive.
   *
   * @example "image-processor"
   * @example "crypto-worker"
   * @example "data-analysis"
   */
  name?: string;

  /**
   * The function to execute in the worker thread.
   *
   * This function:
   * - Runs in a separate Node.js worker thread
   * - Should contain the CPU-intensive logic
   * - Can be async and return any serializable data
   * - Has access to standard Node.js APIs and modules
   * - Cannot directly access the main thread's memory or variables
   *
   * **Important**: The handler function is serialized and sent to the worker thread,
   * so it cannot reference variables from the parent scope (closures won't work).
   * All required data must be passed via the `execute()` method.
   *
   * @example
   * ```ts
   * handler: async () => {
   *   // CPU-intensive work here
   *   const result = performComplexCalculation();
   *   return { result, completed: Date.now() };
   * }
   * ```
   */
  handler: () => any | Promise<any>;

  /**
   * Maximum number of worker threads in the pool.
   *
   * Controls how many threads can run concurrently for this named thread worker.
   * When all threads are busy, additional `execute()` calls will queue until a thread becomes available.
   *
   * **Default**: `cpus().length * 2` (number of CPU cores × 2)
   *
   * **Guidelines**:
   * - For CPU-bound tasks: Set to number of CPU cores
   * - For I/O-bound tasks in workers: Can be higher (2x CPU cores)
   * - For memory-intensive tasks: Set lower to avoid memory pressure
   * - For short-lived tasks: Can be higher for better throughput
   *
   * @default cpus().length * 2
   * @example 4    // Limit to 4 concurrent threads
   * @example 1    // Single worker thread (sequential processing)
   * @example 16   // High concurrency for lightweight tasks
   */
  maxPoolSize?: number;

  /**
   * Time in milliseconds before idle worker threads are terminated.
   *
   * When a worker thread has been idle (not executing any tasks) for this duration,
   * it will be automatically terminated to free up system resources. New threads
   * will be created as needed when new tasks are submitted.
   *
   * **Default**: 60000 (60 seconds)
   *
   * **Considerations**:
   * - Shorter timeouts: Save memory but increase thread creation overhead
   * - Longer timeouts: Keep threads ready but consume more memory
   * - Very short timeouts may cause constant thread creation/destruction
   *
   * @default 60000
   * @example 30000   // 30 seconds
   * @example 120000  // 2 minutes
   * @example 5000    // 5 seconds (for very memory-constrained environments)
   */
  idleTimeout?: number;
}

// ---------------------------------------------------------------------------------------------------------------------

export class ThreadPrimitive extends Primitive<ThreadPrimitiveOptions> {
  protected readonly script = process.argv[1];
  static readonly globalPool = new Map<string, ThreadPool>();

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
    if (!ThreadPrimitive.globalPool.has(this.name)) {
      ThreadPrimitive.globalPool.set(
        this.name,
        new ThreadPool(
          this.name,
          this.maxPoolSize,
          this.idleTimeout,
          this.script,
        ),
      );
    }
    return ThreadPrimitive.globalPool.get(this.name)!;
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
    ThreadPrimitive.globalPool.delete(this.name);
  }
}

$thread[KIND] = ThreadPrimitive;

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
