import { $env, $hook, $inject, type Static, t } from "alepha";
import { $logger } from "alepha/logger";
import {
  type QueueAcquiredJob,
  type QueueCleanOptions,
  type QueueGetJobsOptions,
  type QueueJob,
  type QueueJobCounts,
  type QueueJobOptions,
  type QueueJobStatus,
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

// Lua script for atomic job acquisition
// This script atomically:
// 1. Gets the highest priority job from waiting ZSET
// 2. Removes it from waiting
// 3. Adds it to active SET
// 4. Updates job state in HASH
// Returns: job data as JSON string, or nil if no job available
const ACQUIRE_JOB_SCRIPT = `
local waitingKey = KEYS[1]
local activeKey = KEYS[2]
local jobKeyPrefix = KEYS[3]
local workerId = ARGV[1]
local now = tonumber(ARGV[2])
local lockDuration = tonumber(ARGV[3])

-- Get highest priority job (lowest score)
local jobs = redis.call('ZRANGE', waitingKey, 0, 0)
if #jobs == 0 then
  return nil
end

local jobId = jobs[1]
local jobKey = jobKeyPrefix .. ':' .. jobId

-- Remove from waiting (atomic check)
local removed = redis.call('ZREM', waitingKey, jobId)
if removed == 0 then
  return nil
end

-- Get current job data
local jobData = redis.call('HGETALL', jobKey)
if #jobData == 0 then
  return nil
end

-- Parse job data into table
local job = {}
for i = 1, #jobData, 2 do
  job[jobData[i]] = jobData[i + 1]
end

-- Parse current state
local state = cjson.decode(job['state'])
local options = cjson.decode(job['options'])

-- Update state
state['status'] = 'active'
state['attempts'] = state['attempts'] + 1
state['lockedBy'] = workerId
state['lockedUntil'] = now + (options['lockDuration'] or lockDuration)
state['processedAt'] = now

-- Save updated state
redis.call('HSET', jobKey, 'state', cjson.encode(state))

-- Add to active set
redis.call('SADD', activeKey, jobId)

-- Return job data
return cjson.encode({
  id = job['id'],
  queue = job['queue'],
  payload = cjson.decode(job['payload']),
  options = options,
  state = state
})
`;

// Lua script for completing a job with removeOnComplete support
const COMPLETE_JOB_SCRIPT = `
local jobKey = KEYS[1]
local activeKey = KEYS[2]
local completedKey = KEYS[3]
local jobId = ARGV[1]
local now = tonumber(ARGV[2])
local result = ARGV[3]

-- Get job data
local jobData = redis.call('HGETALL', jobKey)
if #jobData == 0 then
  return nil
end

-- Parse job data
local job = {}
for i = 1, #jobData, 2 do
  job[jobData[i]] = jobData[i + 1]
end

local state = cjson.decode(job['state'])
local options = cjson.decode(job['options'])
local processedAt = state['processedAt'] or now

-- Remove from active
redis.call('SREM', activeKey, jobId)

-- Update state
state['status'] = 'completed'
state['completedAt'] = now
state['result'] = result ~= '' and cjson.decode(result) or nil
state['lockedBy'] = nil
state['lockedUntil'] = nil

local removeOnComplete = options['removeOnComplete']

if removeOnComplete == true then
  -- Remove job immediately
  redis.call('DEL', jobKey)
  return cjson.encode({ removed = true, duration = now - processedAt })
else
  -- Update job state
  redis.call('HSET', jobKey, 'state', cjson.encode(state))

  -- Add to completed list (newest first)
  redis.call('LPUSH', completedKey, jobId)

  -- If removeOnComplete is a number, trim the list (0 means keep none)
  if type(removeOnComplete) == 'number' and removeOnComplete >= 0 then
    -- Get jobs to remove
    local toRemove = redis.call('LRANGE', completedKey, removeOnComplete, -1)
    for _, oldJobId in ipairs(toRemove) do
      redis.call('DEL', jobKey:gsub(jobId, oldJobId))
    end
    redis.call('LTRIM', completedKey, 0, removeOnComplete - 1)
  end

  return cjson.encode({ removed = false, duration = now - processedAt })
end
`;

// Lua script for failing a job with retry support
const FAIL_JOB_SCRIPT = `
local jobKey = KEYS[1]
local activeKey = KEYS[2]
local delayedKey = KEYS[3]
local failedKey = KEYS[4]
local jobId = ARGV[1]
local now = tonumber(ARGV[2])
local errorMsg = ARGV[3]
local stackTrace = ARGV[4]
local backoffDelay = tonumber(ARGV[5])

-- Get job data
local jobData = redis.call('HGETALL', jobKey)
if #jobData == 0 then
  return nil
end

-- Parse job data
local job = {}
for i = 1, #jobData, 2 do
  job[jobData[i]] = jobData[i + 1]
end

local state = cjson.decode(job['state'])
local options = cjson.decode(job['options'])

-- Remove from active
redis.call('SREM', activeKey, jobId)

local maxAttempts = options['maxAttempts'] or 1
local hasMoreAttempts = state['attempts'] < maxAttempts

if hasMoreAttempts then
  -- Schedule for retry
  state['status'] = 'delayed'
  state['availableAt'] = now + backoffDelay
  state['error'] = errorMsg
  state['stackTrace'] = stackTrace ~= '' and stackTrace or nil
  state['lockedBy'] = nil
  state['lockedUntil'] = nil

  redis.call('HSET', jobKey, 'state', cjson.encode(state))
  redis.call('ZADD', delayedKey, now + backoffDelay, jobId)

  return cjson.encode({ status = 'retrying', delay = backoffDelay, attempt = state['attempts'] + 1 })
else
  -- Permanently failed
  state['status'] = 'failed'
  state['failedAt'] = now
  state['error'] = errorMsg
  state['stackTrace'] = stackTrace ~= '' and stackTrace or nil
  state['lockedBy'] = nil
  state['lockedUntil'] = nil

  local removeOnFail = options['removeOnFail']

  if removeOnFail == true then
    redis.call('DEL', jobKey)
    return cjson.encode({ status = 'failed', removed = true, attempts = state['attempts'] })
  else
    redis.call('HSET', jobKey, 'state', cjson.encode(state))
    redis.call('LPUSH', failedKey, jobId)

    if type(removeOnFail) == 'number' and removeOnFail >= 0 then
      local toRemove = redis.call('LRANGE', failedKey, removeOnFail, -1)
      for _, oldJobId in ipairs(toRemove) do
        redis.call('DEL', jobKey:gsub(jobId, oldJobId))
      end
      redis.call('LTRIM', failedKey, 0, removeOnFail - 1)
    end

    return cjson.encode({ status = 'failed', removed = false, attempts = state['attempts'] })
  end
end
`;

/**
 * Redis-based queue provider with full job support.
 *
 * Features:
 * - Atomic job acquisition using Lua scripts
 * - Blocking wait using Redis BZPOPMIN (no polling)
 * - Event emission for job lifecycle
 * - removeOnComplete/removeOnFail support
 *
 * Uses the following Redis data structures:
 * - HASH `{prefix}:job:{queue}:{id}` - Job data
 * - ZSET `{prefix}:waiting:{queue}` - Waiting jobs (score = priority)
 * - ZSET `{prefix}:delayed:{queue}` - Delayed jobs (score = availableAt timestamp)
 * - SET `{prefix}:active:{queue}` - Active jobs
 * - LIST `{prefix}:completed:{queue}` - Completed jobs (newest first)
 * - LIST `{prefix}:failed:{queue}` - Failed jobs (newest first)
 * - LIST `{prefix}:messages:{queue}` - Simple message queue (backward compat)
 * - LIST `{prefix}:notify:{queue}` - Notification list for blocking wait
 */
export class RedisQueueProvider extends QueueProvider {
  protected readonly log = $logger();
  protected readonly env: Static<typeof envSchema> = $env(envSchema);
  protected readonly redisProvider: RedisProvider = $inject(RedisProvider);

  // Dedicated connection for blocking operations
  protected blockingClient: RedisClient | undefined;
  protected shouldStop = false;

  // Loaded Lua script SHAs
  protected acquireJobSha: string | undefined;
  protected completeJobSha: string | undefined;
  protected failJobSha: string | undefined;

  protected readonly start = $hook({
    on: "start",
    handler: async () => {
      this.shouldStop = false;
      this.blockingClient = this.redisProvider.duplicate();
      await this.blockingClient.connect();

      // Load Lua scripts
      const redis = this.redisProvider.publisher;
      const acquireSha = await redis.scriptLoad(ACQUIRE_JOB_SCRIPT);
      const completeSha = await redis.scriptLoad(COMPLETE_JOB_SCRIPT);
      const failSha = await redis.scriptLoad(FAIL_JOB_SCRIPT);
      this.acquireJobSha = acquireSha.toString();
      this.completeJobSha = completeSha.toString();
      this.failJobSha = failSha.toString();
    },
  });

  protected readonly stop = $hook({
    on: "stop",
    handler: async () => {
      this.shouldStop = true;
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

  protected notifyKey(queue: string): string {
    return `${this.env.REDIS_QUEUE_PREFIX}:notify:${queue}`;
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
        removeOnComplete: options?.removeOnComplete,
        removeOnFail: options?.removeOnFail,
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

      // Notify blocking waiters by pushing to notify list
      await redis.LPUSH(this.notifyKey(queue), job.id);
    }

    this.log.debug(`Added job ${job.id} to queue ${queue}`, {
      status: job.state.status,
      priority: job.options.priority,
    });

    // Emit waiting event
    if (!isDelayed) {
      await this.emit({
        type: "waiting",
        queue,
        jobId: job.id,
        timestamp: now,
        job,
      });
    }

    return job;
  }

  public async acquireJob(
    queues: string[],
    workerId: string,
    timeoutSeconds: number,
  ): Promise<QueueAcquiredJob | undefined> {
    if (!this.blockingClient || this.shouldStop) {
      return undefined;
    }

    const redis = this.redisProvider.publisher;
    const now = Date.now();
    const endTime = now + timeoutSeconds * 1000;

    while (Date.now() < endTime && !this.shouldStop) {
      // Try to acquire a job from each queue using Lua script
      for (const queue of queues) {
        try {
          const result = await redis.evalSha(this.acquireJobSha!, {
            keys: [
              this.key("waiting", queue),
              this.key("active", queue),
              this.key("job", queue),
            ],
            arguments: [
              workerId,
              String(Date.now()),
              String(DEFAULT_LOCK_DURATION),
            ],
          });

          if (result) {
            const job = JSON.parse(result as string) as QueueJob;

            this.log.debug(`Worker ${workerId} acquired job ${job.id}`, {
              queue,
              attempt: job.state.attempts,
            });

            // Emit active event
            await this.emit({
              type: "active",
              queue,
              jobId: job.id,
              timestamp: Date.now(),
              workerId,
              attempt: job.state.attempts,
            });

            return { queue, job };
          }
        } catch (error) {
          // Script might fail if job data is corrupted, log and continue
          this.log.warn(`Failed to acquire job from ${queue}`, error);
        }
      }

      // No job found, wait for notification using BRPOP
      // This blocks until a new job is added or timeout
      const notifyKeys = queues.map((q) => this.notifyKey(q));
      const remainingTimeout = Math.max(
        1,
        Math.ceil((endTime - Date.now()) / 1000),
      );

      try {
        const notification = await this.blockingClient.BRPOP(
          notifyKeys,
          Math.min(remainingTimeout, 5), // Check every 5s max for shutdown
        );

        // If we got a notification, loop back to try acquiring
        // The notification just signals that a job was added
        if (notification) {
        }
      } catch {
        // Blocking client closed during shutdown
        if (this.shouldStop) {
          return undefined;
        }
      }
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
    const now = Date.now();

    try {
      const luaResult = await redis.evalSha(this.completeJobSha!, {
        keys: [
          this.key("job", queue, jobId),
          this.key("active", queue),
          this.key("completed", queue),
        ],
        arguments: [
          jobId,
          String(now),
          result !== undefined ? JSON.stringify(result) : "",
        ],
      });

      if (!luaResult) {
        this.log.warn(`Attempted to complete unknown job ${jobId}`);
        return;
      }

      const { removed, duration } = JSON.parse(luaResult as string);
      this.log.debug(`Job ${jobId} completed${removed ? " and removed" : ""}`, {
        queue,
        result,
      });

      // Emit completed event
      await this.emit({
        type: "completed",
        queue,
        jobId,
        timestamp: now,
        result,
        duration,
      });
    } catch (error) {
      // Fallback to non-atomic completion if Lua fails
      this.log.warn(`Lua completeJob failed, using fallback`, error);
      await this.completeJobFallback(queue, jobId, result);
    }
  }

  protected async completeJobFallback(
    queue: string,
    jobId: string,
    result?: unknown,
  ): Promise<void> {
    const redis = this.redisProvider.publisher;
    const now = Date.now();

    // Get job data
    const jobData = await redis.HGETALL(this.key("job", queue, jobId));
    const job = this.deserializeJob(this.bufferRecordToString(jobData));
    if (!job) {
      this.log.warn(`Attempted to complete unknown job ${jobId}`);
      return;
    }

    const duration = now - (job.state.processedAt ?? now);

    // Remove from active
    await redis.SREM(this.key("active", queue), jobId);

    // Update job state
    job.state.status = "completed";
    job.state.completedAt = now;
    job.state.result = result;
    job.state.lockedBy = undefined;
    job.state.lockedUntil = undefined;

    const removeOnComplete = job.options.removeOnComplete;
    if (removeOnComplete === true) {
      await redis.DEL(this.key("job", queue, jobId));
    } else {
      await redis.HSET(this.key("job", queue, jobId), {
        state: JSON.stringify(job.state),
      });
      await redis.LPUSH(this.key("completed", queue), jobId);

      if (typeof removeOnComplete === "number" && removeOnComplete >= 0) {
        await this.cleanJobs(queue, "completed", {
          maxCount: removeOnComplete,
        });
      }
    }

    this.log.debug(`Job ${jobId} completed`, { queue });

    // Emit completed event
    await this.emit({
      type: "completed",
      queue,
      jobId,
      timestamp: now,
      result,
      duration,
    });
  }

  public async failJob(
    queue: string,
    jobId: string,
    error: string,
    stackTrace?: string,
  ): Promise<void> {
    const redis = this.redisProvider.publisher;
    const now = Date.now();

    // Get job to calculate backoff
    const jobData = await redis.HGETALL(this.key("job", queue, jobId));
    const job = this.deserializeJob(this.bufferRecordToString(jobData));
    if (!job) {
      this.log.warn(`Attempted to fail unknown job ${jobId}`);
      return;
    }

    const backoffDelay = this.calculateBackoff(job);

    try {
      const luaResult = await redis.evalSha(this.failJobSha!, {
        keys: [
          this.key("job", queue, jobId),
          this.key("active", queue),
          this.key("delayed", queue),
          this.key("failed", queue),
        ],
        arguments: [
          jobId,
          String(now),
          error,
          stackTrace ?? "",
          String(backoffDelay),
        ],
      });

      if (!luaResult) {
        this.log.warn(`Attempted to fail unknown job ${jobId}`);
        return;
      }

      const result = JSON.parse(luaResult as string);

      if (result.status === "retrying") {
        this.log.debug(`Job ${jobId} failed, will retry in ${result.delay}ms`, {
          queue,
          attempt: job.state.attempts,
          error,
        });

        // Emit retrying event
        await this.emit({
          type: "retrying",
          queue,
          jobId,
          timestamp: now,
          error,
          attempt: result.attempt,
          delay: result.delay,
        });
      } else {
        this.log.debug(
          `Job ${jobId} permanently failed${result.removed ? " and removed" : ""}`,
          { queue, error },
        );

        // Emit failed event
        await this.emit({
          type: "failed",
          queue,
          jobId,
          timestamp: now,
          error,
          stackTrace,
          attempts: result.attempts,
        });
      }
    } catch (luaError) {
      // Fallback to non-atomic fail if Lua fails
      this.log.warn(`Lua failJob failed, using fallback`, luaError);
      await this.failJobFallback(queue, jobId, error, stackTrace);
    }
  }

  protected async failJobFallback(
    queue: string,
    jobId: string,
    error: string,
    stackTrace?: string,
  ): Promise<void> {
    const redis = this.redisProvider.publisher;
    const now = Date.now();

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

      // Emit retrying event
      await this.emit({
        type: "retrying",
        queue,
        jobId,
        timestamp: now,
        error,
        attempt: job.state.attempts + 1,
        delay: backoffDelay,
      });
    } else {
      job.state.status = "failed";
      job.state.failedAt = now;
      job.state.error = error;
      job.state.stackTrace = stackTrace;
      job.state.lockedBy = undefined;
      job.state.lockedUntil = undefined;

      const removeOnFail = job.options.removeOnFail;
      if (removeOnFail === true) {
        await redis.DEL(this.key("job", queue, jobId));
      } else {
        await redis.HSET(this.key("job", queue, jobId), {
          state: JSON.stringify(job.state),
        });
        await redis.LPUSH(this.key("failed", queue), jobId);

        if (typeof removeOnFail === "number" && removeOnFail >= 0) {
          await this.cleanJobs(queue, "failed", { maxCount: removeOnFail });
        }
      }

      this.log.debug(`Job ${jobId} permanently failed`, { queue });

      // Emit failed event
      await this.emit({
        type: "failed",
        queue,
        jobId,
        timestamp: now,
        error,
        stackTrace,
        attempts: job.state.attempts,
      });
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

      // Notify waiting workers
      await redis.LPUSH(this.notifyKey(queue), jobId);

      promoted++;
      this.log.debug(`Promoted delayed job ${jobId}`, { queue });

      // Emit waiting event
      await this.emit({
        type: "waiting",
        queue,
        jobId,
        timestamp: now,
        job,
      });
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
      const workerId = job.state.lockedBy;

      // Remove from active
      await redis.SREM(this.key("active", queue), jobId);

      const maxAttempts = job.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
      const hasMoreAttempts = job.state.attempts < maxAttempts;

      // Emit stalled event
      await this.emit({
        type: "stalled",
        queue,
        jobId,
        timestamp: now,
        workerId,
        willRetry: hasMoreAttempts,
      });

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

        // Notify waiting workers
        await redis.LPUSH(this.notifyKey(queue), jobId);

        this.log.warn(`Recovered stalled job ${jobId}`, { queue });

        // Emit waiting event
        await this.emit({
          type: "waiting",
          queue,
          jobId,
          timestamp: now,
          job,
        });
      } else {
        job.state.status = "failed";
        job.state.failedAt = now;
        job.state.lockedBy = undefined;
        job.state.lockedUntil = undefined;
        job.state.error =
          "Job stalled (worker timeout) - max attempts exceeded";

        const removeOnFail = job.options.removeOnFail;
        if (removeOnFail === true) {
          await redis.DEL(this.key("job", queue, jobId));
        } else {
          await redis.HSET(this.key("job", queue, jobId), {
            state: JSON.stringify(job.state),
          });
          await redis.LPUSH(this.key("failed", queue), jobId);

          if (typeof removeOnFail === "number" && removeOnFail >= 0) {
            await this.cleanJobs(queue, "failed", { maxCount: removeOnFail });
          }
        }

        this.log.warn(`Stalled job ${jobId} permanently failed`, { queue });

        // Emit failed event
        await this.emit({
          type: "failed",
          queue,
          jobId,
          timestamp: now,
          error: job.state.error,
          attempts: job.state.attempts,
        });
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

    const previousStatus = job.state.status;

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

    // Emit removed event
    await this.emit({
      type: "removed",
      queue,
      jobId,
      timestamp: Date.now(),
      previousStatus,
    });
  }

  public cancelWaiters(): void {
    this.shouldStop = true;
  }
}
