import { $env, $hook, $inject, type Static, t } from "alepha";
import { $logger } from "alepha/logger";
import type {
  QueueAcquiredJob,
  QueueCleanOptions,
  QueueGetJobsOptions,
  QueueJob,
  QueueJobCounts,
  QueueJobOptions,
  QueueJobStatus,
  QueueProvider,
} from "alepha/queue";
import { type RedisClient, RedisProvider } from "alepha/redis";

// Default job options
const DEFAULT_MAX_ATTEMPTS = 1;
const DEFAULT_LOCK_DURATION = 30000; // 30 seconds
const DEFAULT_BACKOFF_DELAY = 1000; // 1 second
const DEFAULT_BACKOFF_MAX_DELAY = 30000; // 30 seconds

const envSchema = t.object({
  REDIS_QUEUE_PREFIX: t.text({
    default: "queue",
  }),
});

/**
 * Redis-based queue provider with full job support.
 *
 * Uses the following Redis data structures:
 * - HASH `{prefix}:job:{queue}:{id}` - Job data
 * - ZSET `{prefix}:waiting:{queue}` - Waiting jobs (score = priority)
 * - ZSET `{prefix}:delayed:{queue}` - Delayed jobs (score = availableAt timestamp)
 * - SET `{prefix}:active:{queue}` - Active jobs
 * - LIST `{prefix}:completed:{queue}` - Completed jobs (newest first)
 * - LIST `{prefix}:failed:{queue}` - Failed jobs (newest first)
 * - LIST `{prefix}:messages:{queue}` - Simple message queue (backward compat)
 */
export class RedisQueueProvider implements QueueProvider {
  protected readonly log = $logger();
  protected readonly env: Static<typeof envSchema> = $env(envSchema);
  protected readonly redisProvider: RedisProvider = $inject(RedisProvider);

  // Dedicated connection for blocking operations
  protected blockingClient: RedisClient | undefined;
  protected shouldStop = false;

  protected readonly start = $hook({
    on: "start",
    handler: async () => {
      this.blockingClient = this.redisProvider.duplicate();
      await this.blockingClient.connect();
    },
  });

  protected readonly stop = $hook({
    on: "stop",
    handler: async () => {
      if (this.blockingClient?.isOpen) {
        await this.blockingClient.close();
      }
    },
  });

  // ===========================================
  // Key helpers
  // ===========================================

  protected key(type: string, queue: string, id?: string): string {
    const base = `${this.env.REDIS_QUEUE_PREFIX}:${type}:${queue}`;
    return id ? `${base}:${id}` : base;
  }

  protected messageKey(queue: string): string {
    return `${this.env.REDIS_QUEUE_PREFIX}:${queue}`;
  }

  // ===========================================
  // Simple Message API (backward compatible)
  // ===========================================

  public async push(queue: string, message: string): Promise<void> {
    await this.redisProvider.publisher.LPUSH(this.messageKey(queue), message);
  }

  public async pop(queue: string): Promise<string | undefined> {
    const value = await this.redisProvider.publisher.RPOP(
      this.messageKey(queue),
    );
    if (value == null) return undefined;
    return String(value);
  }

  public async popBlocking(
    queues: string[],
    timeoutSeconds: number,
  ): Promise<{ queue: string; message: string } | undefined> {
    if (queues.length === 0 || !this.blockingClient) {
      return undefined;
    }

    const prefixedQueues = queues.map((q) => this.messageKey(q));
    const result = await this.blockingClient.BRPOP(
      prefixedQueues,
      timeoutSeconds,
    );

    if (result == null) return undefined;

    const key = result.key.toString();
    const prefixLength = this.env.REDIS_QUEUE_PREFIX.length + 1;
    const queue = key.substring(prefixLength);

    return { queue, message: result.element.toString() };
  }

  // ===========================================
  // Job API Implementation
  // ===========================================

  protected async generateJobId(): Promise<string> {
    const counter = await this.redisProvider.publisher.INCR(
      `${this.env.REDIS_QUEUE_PREFIX}:job_counter`,
    );
    return `job_${counter}_${Date.now()}`;
  }

  protected serializeJob(job: QueueJob): Record<string, string> {
    return {
      id: job.id,
      queue: job.queue,
      payload: JSON.stringify(job.payload),
      options: JSON.stringify(job.options),
      state: JSON.stringify(job.state),
    };
  }

  protected deserializeJob(data: Record<string, string>): QueueJob | undefined {
    if (!data.id) return undefined;
    return {
      id: data.id,
      queue: data.queue,
      payload: JSON.parse(data.payload),
      options: JSON.parse(data.options),
      state: JSON.parse(data.state),
    };
  }

  public async addJob<T>(
    queue: string,
    payload: T,
    options?: QueueJobOptions,
  ): Promise<QueueJob<T>> {
    const redis = this.redisProvider.publisher;
    const now = Date.now();
    const delay = options?.delay ?? 0;
    const isDelayed = delay > 0;

    const job: QueueJob<T> = {
      id: await this.generateJobId(),
      queue,
      payload,
      options: {
        priority: options?.priority ?? 0,
        delay: options?.delay ?? 0,
        maxAttempts: options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        backoff: options?.backoff,
        lockDuration: options?.lockDuration ?? DEFAULT_LOCK_DURATION,
      },
      state: {
        status: isDelayed ? "delayed" : "waiting",
        attempts: 0,
        createdAt: now,
        availableAt: isDelayed ? now + delay : now,
      },
    };

    // Store job data
    await redis.HSET(this.key("job", queue, job.id), this.serializeJob(job));

    // Add to appropriate queue
    if (isDelayed) {
      await redis.ZADD(this.key("delayed", queue), {
        score: job.state.availableAt!,
        value: job.id,
      });
    } else {
      await redis.ZADD(this.key("waiting", queue), {
        score: job.options.priority ?? 0,
        value: job.id,
      });
    }

    this.log.debug(`Added job ${job.id} to queue ${queue}`, {
      status: job.state.status,
      priority: job.options.priority,
    });

    return job;
  }

  public async acquireJob(
    queues: string[],
    workerId: string,
    timeoutSeconds: number,
  ): Promise<QueueAcquiredJob | undefined> {
    const redis = this.redisProvider.publisher;
    const endTime = Date.now() + timeoutSeconds * 1000;

    while (Date.now() < endTime && !this.shouldStop) {
      for (const queue of queues) {
        // Get highest priority job (lowest score)
        const results = await redis.ZRANGE(this.key("waiting", queue), 0, 0);
        if (results.length === 0) continue;

        const jobId = results[0].toString();

        // Try to move to active (atomic operation using WATCH/MULTI)
        const removed = await redis.ZREM(this.key("waiting", queue), jobId);
        if (removed === 0) continue; // Job was taken by another worker

        // Get job data
        const jobData = await redis.HGETALL(this.key("job", queue, jobId));
        const job = this.deserializeJob(this.bufferRecordToString(jobData));
        if (!job) continue;

        const now = Date.now();

        // Update job state
        job.state.status = "active";
        job.state.attempts += 1;
        job.state.lockedBy = workerId;
        job.state.lockedUntil =
          now + (job.options.lockDuration ?? DEFAULT_LOCK_DURATION);
        job.state.processedAt = now;

        // Store updated state and add to active set
        await redis.HSET(this.key("job", queue, jobId), {
          state: JSON.stringify(job.state),
        });
        await redis.SADD(this.key("active", queue), jobId);

        this.log.debug(`Worker ${workerId} acquired job ${jobId}`, {
          queue,
          attempt: job.state.attempts,
        });

        return { queue, job };
      }

      // No jobs available, wait a bit before trying again
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return undefined;
  }

  protected bufferRecordToString(
    record: Record<string, Buffer>,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      result[key] = value?.toString() ?? "";
    }
    return result;
  }

  public async completeJob(
    queue: string,
    jobId: string,
    result?: unknown,
  ): Promise<void> {
    const redis = this.redisProvider.publisher;

    // Get job data
    const jobData = await redis.HGETALL(this.key("job", queue, jobId));
    const job = this.deserializeJob(this.bufferRecordToString(jobData));
    if (!job) {
      this.log.warn(`Attempted to complete unknown job ${jobId}`);
      return;
    }

    // Remove from active
    await redis.SREM(this.key("active", queue), jobId);

    // Update job state
    job.state.status = "completed";
    job.state.completedAt = Date.now();
    job.state.result = result;
    job.state.lockedBy = undefined;
    job.state.lockedUntil = undefined;

    await redis.HSET(this.key("job", queue, jobId), {
      state: JSON.stringify(job.state),
    });

    // Add to completed list (newest first)
    await redis.LPUSH(this.key("completed", queue), jobId);

    this.log.debug(`Job ${jobId} completed`, { queue });
  }

  public async failJob(
    queue: string,
    jobId: string,
    error: string,
    stackTrace?: string,
  ): Promise<void> {
    const redis = this.redisProvider.publisher;

    const jobData = await redis.HGETALL(this.key("job", queue, jobId));
    const job = this.deserializeJob(this.bufferRecordToString(jobData));
    if (!job) {
      this.log.warn(`Attempted to fail unknown job ${jobId}`);
      return;
    }

    // Remove from active
    await redis.SREM(this.key("active", queue), jobId);

    const maxAttempts = job.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const hasMoreAttempts = job.state.attempts < maxAttempts;

    if (hasMoreAttempts) {
      const backoffDelay = this.calculateBackoff(job);
      const now = Date.now();

      job.state.status = "delayed";
      job.state.availableAt = now + backoffDelay;
      job.state.error = error;
      job.state.stackTrace = stackTrace;
      job.state.lockedBy = undefined;
      job.state.lockedUntil = undefined;

      await redis.HSET(this.key("job", queue, jobId), {
        state: JSON.stringify(job.state),
      });
      await redis.ZADD(this.key("delayed", queue), {
        score: job.state.availableAt,
        value: jobId,
      });

      this.log.debug(`Job ${jobId} failed, will retry in ${backoffDelay}ms`, {
        queue,
        attempt: job.state.attempts,
        maxAttempts,
      });
    } else {
      job.state.status = "failed";
      job.state.failedAt = Date.now();
      job.state.error = error;
      job.state.stackTrace = stackTrace;
      job.state.lockedBy = undefined;
      job.state.lockedUntil = undefined;

      await redis.HSET(this.key("job", queue, jobId), {
        state: JSON.stringify(job.state),
      });
      await redis.LPUSH(this.key("failed", queue), jobId);

      this.log.debug(`Job ${jobId} permanently failed`, { queue });
    }
  }

  protected calculateBackoff(job: QueueJob): number {
    const backoff = job.options.backoff;
    const attempt = job.state.attempts;

    if (!backoff) return DEFAULT_BACKOFF_DELAY;

    const baseDelay = backoff.delay ?? DEFAULT_BACKOFF_DELAY;
    const maxDelay = backoff.maxDelay ?? DEFAULT_BACKOFF_MAX_DELAY;

    if (backoff.type === "fixed") return baseDelay;

    const exponentialDelay = baseDelay * 2 ** (attempt - 1);
    return Math.min(exponentialDelay, maxDelay);
  }

  public async renewJobLock(
    queue: string,
    jobId: string,
    workerId: string,
  ): Promise<boolean> {
    const redis = this.redisProvider.publisher;

    const jobData = await redis.HGETALL(this.key("job", queue, jobId));
    const job = this.deserializeJob(this.bufferRecordToString(jobData));
    if (!job || job.state.lockedBy !== workerId) {
      return false;
    }

    job.state.lockedUntil =
      Date.now() + (job.options.lockDuration ?? DEFAULT_LOCK_DURATION);
    await redis.HSET(this.key("job", queue, jobId), {
      state: JSON.stringify(job.state),
    });

    return true;
  }

  public async getJob(
    queue: string,
    jobId: string,
  ): Promise<QueueJob | undefined> {
    const redis = this.redisProvider.publisher;
    const jobData = await redis.HGETALL(this.key("job", queue, jobId));
    return this.deserializeJob(this.bufferRecordToString(jobData));
  }

  public async getJobs(
    queue: string,
    status: QueueJobStatus,
    options?: QueueGetJobsOptions,
  ): Promise<QueueJob[]> {
    const redis = this.redisProvider.publisher;
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    let jobIds: string[];

    switch (status) {
      case "waiting": {
        const results = await redis.ZRANGE(
          this.key("waiting", queue),
          offset,
          offset + limit - 1,
        );
        jobIds = results.map((r) => r.toString());
        break;
      }
      case "delayed": {
        const results = await redis.ZRANGE(
          this.key("delayed", queue),
          offset,
          offset + limit - 1,
        );
        jobIds = results.map((r) => r.toString());
        break;
      }
      case "active": {
        const results = await redis.SMEMBERS(this.key("active", queue));
        jobIds = results.map((r) => r.toString()).slice(offset, offset + limit);
        break;
      }
      case "completed": {
        const results = await redis.LRANGE(
          this.key("completed", queue),
          offset,
          offset + limit - 1,
        );
        jobIds = results.map((r) => r.toString());
        break;
      }
      case "failed": {
        const results = await redis.LRANGE(
          this.key("failed", queue),
          offset,
          offset + limit - 1,
        );
        jobIds = results.map((r) => r.toString());
        break;
      }
      default:
        jobIds = [];
    }

    const jobs: QueueJob[] = [];
    for (const jobId of jobIds) {
      const job = await this.getJob(queue, jobId);
      if (job) jobs.push(job);
    }

    return jobs;
  }

  public async getJobCounts(queue: string): Promise<QueueJobCounts> {
    const redis = this.redisProvider.publisher;

    const [waiting, delayed, active, completed, failed] = await Promise.all([
      redis.ZCARD(this.key("waiting", queue)),
      redis.ZCARD(this.key("delayed", queue)),
      redis.SCARD(this.key("active", queue)),
      redis.LLEN(this.key("completed", queue)),
      redis.LLEN(this.key("failed", queue)),
    ]);

    return { waiting, delayed, active, completed, failed };
  }

  public async promoteDelayedJobs(queue: string): Promise<number> {
    const redis = this.redisProvider.publisher;
    const now = Date.now();

    // Get jobs whose availableAt has passed
    const results = await redis.ZRANGEBYSCORE(
      this.key("delayed", queue),
      "-inf",
      now,
    );

    let promoted = 0;
    for (const result of results) {
      const jobId = result.toString();

      // Remove from delayed
      const removed = await redis.ZREM(this.key("delayed", queue), jobId);
      if (removed === 0) continue;

      // Get and update job
      const job = await this.getJob(queue, jobId);
      if (!job) continue;

      job.state.status = "waiting";
      await redis.HSET(this.key("job", queue, jobId), {
        state: JSON.stringify(job.state),
      });

      // Add to waiting with priority score
      await redis.ZADD(this.key("waiting", queue), {
        score: job.options.priority ?? 0,
        value: jobId,
      });

      promoted++;
      this.log.debug(`Promoted delayed job ${jobId}`, { queue });
    }

    return promoted;
  }

  public async recoverStalledJobs(
    queue: string,
    stalledThresholdMs: number,
  ): Promise<string[]> {
    const redis = this.redisProvider.publisher;
    const now = Date.now();

    const activeJobIds = await redis.SMEMBERS(this.key("active", queue));
    const stalledJobIds: string[] = [];

    for (const result of activeJobIds) {
      const jobId = result.toString();
      const job = await this.getJob(queue, jobId);
      if (!job) continue;

      const lockExpired =
        (job.state.lockedUntil ?? 0) + stalledThresholdMs < now;
      if (!lockExpired) continue;

      stalledJobIds.push(jobId);

      // Remove from active
      await redis.SREM(this.key("active", queue), jobId);

      const maxAttempts = job.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
      const hasMoreAttempts = job.state.attempts < maxAttempts;

      if (hasMoreAttempts) {
        job.state.status = "waiting";
        job.state.lockedBy = undefined;
        job.state.lockedUntil = undefined;
        job.state.error = "Job stalled (worker timeout)";

        await redis.HSET(this.key("job", queue, jobId), {
          state: JSON.stringify(job.state),
        });
        await redis.ZADD(this.key("waiting", queue), {
          score: job.options.priority ?? 0,
          value: jobId,
        });

        this.log.warn(`Recovered stalled job ${jobId}`, { queue });
      } else {
        job.state.status = "failed";
        job.state.failedAt = now;
        job.state.lockedBy = undefined;
        job.state.lockedUntil = undefined;
        job.state.error =
          "Job stalled (worker timeout) - max attempts exceeded";

        await redis.HSET(this.key("job", queue, jobId), {
          state: JSON.stringify(job.state),
        });
        await redis.LPUSH(this.key("failed", queue), jobId);

        this.log.warn(`Stalled job ${jobId} permanently failed`, { queue });
      }
    }

    return stalledJobIds;
  }

  public async cleanJobs(
    queue: string,
    status: "completed" | "failed",
    options?: QueueCleanOptions,
  ): Promise<number> {
    const redis = this.redisProvider.publisher;
    const listKey = this.key(status, queue);
    const maxAge = options?.maxAge;
    const maxCount = options?.maxCount;

    let removed = 0;

    // Remove by age
    if (maxAge !== undefined) {
      const now = Date.now();
      const cutoff = now - maxAge;

      const jobIds = await redis.LRANGE(listKey, 0, -1);
      for (const result of jobIds) {
        const jobId = result.toString();
        const job = await this.getJob(queue, jobId);
        if (!job) continue;

        const timestamp =
          status === "completed" ? job.state.completedAt : job.state.failedAt;

        if (timestamp && timestamp < cutoff) {
          await redis.LREM(listKey, 1, jobId);
          await redis.DEL(this.key("job", queue, jobId));
          removed++;
        }
      }
    }

    // Remove by count
    if (maxCount !== undefined) {
      const currentLen = await redis.LLEN(listKey);
      if (currentLen > maxCount) {
        // Get jobs to remove (oldest ones)
        const toRemove = await redis.LRANGE(listKey, maxCount, -1);
        for (const result of toRemove) {
          const jobId = result.toString();
          await redis.DEL(this.key("job", queue, jobId));
          removed++;
        }
        // Trim the list
        await redis.LTRIM(listKey, 0, maxCount - 1);
      }
    }

    return removed;
  }

  public async removeJob(queue: string, jobId: string): Promise<void> {
    const redis = this.redisProvider.publisher;
    const job = await this.getJob(queue, jobId);
    if (!job) return;

    // Remove from appropriate list
    switch (job.state.status) {
      case "waiting":
        await redis.ZREM(this.key("waiting", queue), jobId);
        break;
      case "delayed":
        await redis.ZREM(this.key("delayed", queue), jobId);
        break;
      case "active":
        await redis.SREM(this.key("active", queue), jobId);
        break;
      case "completed":
        await redis.LREM(this.key("completed", queue), 1, jobId);
        break;
      case "failed":
        await redis.LREM(this.key("failed", queue), 1, jobId);
        break;
    }

    // Delete job data
    await redis.DEL(this.key("job", queue, jobId));
  }

  public cancelWaiters(): void {
    this.shouldStop = true;
  }
}
