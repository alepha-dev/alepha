import { $logger } from "alepha/logger";
import type {
  QueueAcquiredJob,
  QueueCleanOptions,
  QueueGetJobsOptions,
  QueueJob,
  QueueJobCounts,
  QueueJobOptions,
  QueueJobStatus,
} from "../interfaces/QueueJob.ts";
import type { QueueProvider } from "./QueueProvider.ts";

// Default job options
const DEFAULT_MAX_ATTEMPTS = 1;
const DEFAULT_LOCK_DURATION = 30000; // 30 seconds
const DEFAULT_BACKOFF_DELAY = 1000; // 1 second
const DEFAULT_BACKOFF_MAX_DELAY = 30000; // 30 seconds

interface MessageWaiter {
  queues: Set<string>;
  resolve: (result: { queue: string; message: string }) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface JobWaiter {
  queues: Set<string>;
  workerId: string;
  resolve: (result: QueueAcquiredJob | undefined) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * In-memory queue provider with full job support.
 *
 * This provider stores all data in memory and is suitable for:
 * - Development and testing
 * - Single-instance applications
 * - Scenarios where job persistence across restarts is not required
 */
export class MemoryQueueProvider implements QueueProvider {
  protected readonly log = $logger();

  // Simple message API storage
  protected messageQueues: Record<string, string[]> = {};
  protected messageWaiters: Set<MessageWaiter> = new Set();

  // Job API storage (per queue)
  protected jobs: Map<string, Map<string, QueueJob>> = new Map(); // queue -> jobId -> job
  protected waiting: Map<string, string[]> = new Map(); // queue -> jobIds (sorted by priority)
  protected delayed: Map<string, string[]> = new Map(); // queue -> jobIds (sorted by availableAt)
  protected active: Map<string, Set<string>> = new Map(); // queue -> jobIds
  protected completed: Map<string, string[]> = new Map(); // queue -> jobIds (newest first)
  protected failed: Map<string, string[]> = new Map(); // queue -> jobIds (newest first)
  protected jobWaiters: Set<JobWaiter> = new Set();

  protected jobIdCounter = 0;

  // ===========================================
  // Simple Message API
  // ===========================================

  public async push(queue: string, ...messages: string[]): Promise<void> {
    if (this.messageQueues[queue] == null) {
      this.messageQueues[queue] = [];
    }

    for (const message of messages) {
      const waiter = this.findMessageWaiter(queue);
      if (waiter) {
        this.removeMessageWaiter(waiter);
        waiter.resolve({ queue, message });
      } else {
        this.messageQueues[queue].push(message);
      }
    }
  }

  public async pop(queue: string): Promise<string | undefined> {
    return this.messageQueues[queue]?.shift();
  }

  public async popBlocking(
    queues: string[],
    timeoutSeconds: number,
  ): Promise<{ queue: string; message: string } | undefined> {
    for (const queue of queues) {
      const message = this.messageQueues[queue]?.shift();
      if (message) {
        return { queue, message };
      }
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.removeMessageWaiter(waiter);
        resolve(undefined);
      }, timeoutSeconds * 1000);

      const waiter: MessageWaiter = {
        queues: new Set(queues),
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        timer,
      };

      this.messageWaiters.add(waiter);
    });
  }

  protected findMessageWaiter(queue: string): MessageWaiter | undefined {
    for (const waiter of this.messageWaiters) {
      if (waiter.queues.has(queue)) {
        return waiter;
      }
    }
    return undefined;
  }

  protected removeMessageWaiter(waiter: MessageWaiter): void {
    clearTimeout(waiter.timer);
    this.messageWaiters.delete(waiter);
  }

  // ===========================================
  // Job API Implementation
  // ===========================================

  protected generateJobId(): string {
    return `job_${++this.jobIdCounter}_${Date.now()}`;
  }

  protected ensureQueueStructures(queue: string): void {
    if (!this.jobs.has(queue)) {
      this.jobs.set(queue, new Map());
      this.waiting.set(queue, []);
      this.delayed.set(queue, []);
      this.active.set(queue, new Set());
      this.completed.set(queue, []);
      this.failed.set(queue, []);
    }
  }

  public async addJob<T>(
    queue: string,
    payload: T,
    options?: QueueJobOptions,
  ): Promise<QueueJob<T>> {
    this.ensureQueueStructures(queue);

    const now = Date.now();
    const delay = options?.delay ?? 0;
    const isDelayed = delay > 0;

    const job: QueueJob<T> = {
      id: this.generateJobId(),
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

    this.jobs.get(queue)!.set(job.id, job);

    if (isDelayed) {
      this.insertDelayed(queue, job);
    } else {
      this.insertWaiting(queue, job);
      this.notifyJobWaiters(queue);
    }

    this.log.debug(`Added job ${job.id} to queue ${queue}`, {
      status: job.state.status,
      priority: job.options.priority,
    });

    return job;
  }

  protected insertWaiting(queue: string, job: QueueJob): void {
    const waitingList = this.waiting.get(queue)!;
    const priority = job.options.priority ?? 0;

    // Insert in priority order (lower priority value = higher priority)
    let insertIndex = waitingList.length;
    for (let i = 0; i < waitingList.length; i++) {
      const existingJob = this.jobs.get(queue)!.get(waitingList[i]);
      if (existingJob && (existingJob.options.priority ?? 0) > priority) {
        insertIndex = i;
        break;
      }
    }
    waitingList.splice(insertIndex, 0, job.id);
  }

  protected insertDelayed(queue: string, job: QueueJob): void {
    const delayedList = this.delayed.get(queue)!;
    const availableAt = job.state.availableAt ?? 0;

    // Insert sorted by availableAt (ascending)
    let insertIndex = delayedList.length;
    for (let i = 0; i < delayedList.length; i++) {
      const existingJob = this.jobs.get(queue)!.get(delayedList[i]);
      if (existingJob && (existingJob.state.availableAt ?? 0) > availableAt) {
        insertIndex = i;
        break;
      }
    }
    delayedList.splice(insertIndex, 0, job.id);
  }

  protected notifyJobWaiters(queue: string): void {
    for (const waiter of this.jobWaiters) {
      if (waiter.queues.has(queue)) {
        // Try to acquire a job for this waiter
        const result = this.tryAcquireJob(
          Array.from(waiter.queues),
          waiter.workerId,
        );
        if (result) {
          this.removeJobWaiter(waiter);
          waiter.resolve(result);
          return;
        }
      }
    }
  }

  protected removeJobWaiter(waiter: JobWaiter): void {
    clearTimeout(waiter.timer);
    this.jobWaiters.delete(waiter);
  }

  protected tryAcquireJob(
    queues: string[],
    workerId: string,
  ): QueueAcquiredJob | undefined {
    const now = Date.now();

    for (const queue of queues) {
      const waitingList = this.waiting.get(queue);
      if (!waitingList || waitingList.length === 0) continue;

      const jobId = waitingList.shift()!;
      const job = this.jobs.get(queue)!.get(jobId);
      if (!job) continue;

      // Move to active
      job.state.status = "active";
      job.state.attempts += 1;
      job.state.lockedBy = workerId;
      job.state.lockedUntil =
        now + (job.options.lockDuration ?? DEFAULT_LOCK_DURATION);
      job.state.processedAt = now;

      this.active.get(queue)!.add(jobId);

      this.log.debug(`Worker ${workerId} acquired job ${jobId}`, {
        queue,
        attempt: job.state.attempts,
      });

      return { queue, job };
    }

    return undefined;
  }

  public async acquireJob(
    queues: string[],
    workerId: string,
    timeoutSeconds: number,
  ): Promise<QueueAcquiredJob | undefined> {
    // Ensure queue structures exist
    for (const queue of queues) {
      this.ensureQueueStructures(queue);
    }

    // Try to acquire immediately
    const result = this.tryAcquireJob(queues, workerId);
    if (result) {
      return result;
    }

    // Wait for a job
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.removeJobWaiter(waiter);
        resolve(undefined);
      }, timeoutSeconds * 1000);

      const waiter: JobWaiter = {
        queues: new Set(queues),
        workerId,
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        timer,
      };

      this.jobWaiters.add(waiter);
    });
  }

  public async completeJob(
    queue: string,
    jobId: string,
    result?: unknown,
  ): Promise<void> {
    const job = this.jobs.get(queue)?.get(jobId);
    if (!job) {
      this.log.warn(`Attempted to complete unknown job ${jobId}`);
      return;
    }

    // Remove from active
    this.active.get(queue)?.delete(jobId);

    // Update job state
    job.state.status = "completed";
    job.state.completedAt = Date.now();
    job.state.result = result;
    job.state.lockedBy = undefined;
    job.state.lockedUntil = undefined;

    // Add to completed history (newest first)
    this.completed.get(queue)!.unshift(jobId);

    this.log.debug(`Job ${jobId} completed`, { queue, result });
  }

  public async failJob(
    queue: string,
    jobId: string,
    error: string,
    stackTrace?: string,
  ): Promise<void> {
    const job = this.jobs.get(queue)?.get(jobId);
    if (!job) {
      this.log.warn(`Attempted to fail unknown job ${jobId}`);
      return;
    }

    // Remove from active
    this.active.get(queue)?.delete(jobId);

    const maxAttempts = job.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const hasMoreAttempts = job.state.attempts < maxAttempts;

    if (hasMoreAttempts) {
      // Calculate backoff delay for retry
      const backoffDelay = this.calculateBackoff(job);
      const now = Date.now();

      job.state.status = "delayed";
      job.state.availableAt = now + backoffDelay;
      job.state.error = error;
      job.state.stackTrace = stackTrace;
      job.state.lockedBy = undefined;
      job.state.lockedUntil = undefined;

      this.insertDelayed(queue, job);

      this.log.debug(`Job ${jobId} failed, will retry in ${backoffDelay}ms`, {
        queue,
        attempt: job.state.attempts,
        maxAttempts,
        error,
      });
    } else {
      // No more retries, mark as permanently failed
      job.state.status = "failed";
      job.state.failedAt = Date.now();
      job.state.error = error;
      job.state.stackTrace = stackTrace;
      job.state.lockedBy = undefined;
      job.state.lockedUntil = undefined;

      this.failed.get(queue)!.unshift(jobId);

      this.log.debug(
        `Job ${jobId} permanently failed after ${job.state.attempts} attempts`,
        {
          queue,
          error,
        },
      );
    }
  }

  protected calculateBackoff(job: QueueJob): number {
    const backoff = job.options.backoff;
    const attempt = job.state.attempts;

    if (!backoff) {
      return DEFAULT_BACKOFF_DELAY;
    }

    const baseDelay = backoff.delay ?? DEFAULT_BACKOFF_DELAY;
    const maxDelay = backoff.maxDelay ?? DEFAULT_BACKOFF_MAX_DELAY;

    if (backoff.type === "fixed") {
      return baseDelay;
    }

    // Exponential backoff: delay * 2^(attempt-1)
    const exponentialDelay = baseDelay * 2 ** (attempt - 1);
    return Math.min(exponentialDelay, maxDelay);
  }

  public async renewJobLock(
    queue: string,
    jobId: string,
    workerId: string,
  ): Promise<boolean> {
    const job = this.jobs.get(queue)?.get(jobId);
    if (!job || job.state.lockedBy !== workerId) {
      return false;
    }

    job.state.lockedUntil =
      Date.now() + (job.options.lockDuration ?? DEFAULT_LOCK_DURATION);
    return true;
  }

  public async getJob(
    queue: string,
    jobId: string,
  ): Promise<QueueJob | undefined> {
    return this.jobs.get(queue)?.get(jobId);
  }

  public async getJobs(
    queue: string,
    status: QueueJobStatus,
    options?: QueueGetJobsOptions,
  ): Promise<QueueJob[]> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    let jobIds: string[];
    switch (status) {
      case "waiting":
        jobIds = this.waiting.get(queue) ?? [];
        break;
      case "delayed":
        jobIds = this.delayed.get(queue) ?? [];
        break;
      case "active":
        jobIds = Array.from(this.active.get(queue) ?? []);
        break;
      case "completed":
        jobIds = this.completed.get(queue) ?? [];
        break;
      case "failed":
        jobIds = this.failed.get(queue) ?? [];
        break;
      default:
        jobIds = [];
    }

    const jobsMap = this.jobs.get(queue);
    if (!jobsMap) return [];

    return jobIds
      .slice(offset, offset + limit)
      .map((id) => jobsMap.get(id))
      .filter((job): job is QueueJob => job !== undefined);
  }

  public async getJobCounts(queue: string): Promise<QueueJobCounts> {
    return {
      waiting: this.waiting.get(queue)?.length ?? 0,
      delayed: this.delayed.get(queue)?.length ?? 0,
      active: this.active.get(queue)?.size ?? 0,
      completed: this.completed.get(queue)?.length ?? 0,
      failed: this.failed.get(queue)?.length ?? 0,
    };
  }

  public async promoteDelayedJobs(queue: string): Promise<number> {
    const delayedList = this.delayed.get(queue);
    if (!delayedList || delayedList.length === 0) return 0;

    const now = Date.now();
    let promoted = 0;

    while (delayedList.length > 0) {
      const jobId = delayedList[0];
      const job = this.jobs.get(queue)?.get(jobId);

      if (!job || (job.state.availableAt ?? 0) > now) {
        break; // No more jobs ready
      }

      // Remove from delayed
      delayedList.shift();

      // Move to waiting
      job.state.status = "waiting";
      this.insertWaiting(queue, job);
      promoted++;

      this.log.debug(`Promoted delayed job ${jobId}`, { queue });
    }

    if (promoted > 0) {
      this.notifyJobWaiters(queue);
    }

    return promoted;
  }

  public async recoverStalledJobs(
    queue: string,
    stalledThresholdMs: number,
  ): Promise<string[]> {
    const activeSet = this.active.get(queue);
    if (!activeSet || activeSet.size === 0) return [];

    const now = Date.now();
    const stalledJobIds: string[] = [];

    for (const jobId of activeSet) {
      const job = this.jobs.get(queue)?.get(jobId);
      if (!job) continue;

      const lockExpired =
        (job.state.lockedUntil ?? 0) + stalledThresholdMs < now;
      if (lockExpired) {
        stalledJobIds.push(jobId);
      }
    }

    for (const jobId of stalledJobIds) {
      const job = this.jobs.get(queue)!.get(jobId)!;
      activeSet.delete(jobId);

      const maxAttempts = job.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
      const hasMoreAttempts = job.state.attempts < maxAttempts;

      if (hasMoreAttempts) {
        // Return to waiting for retry
        job.state.status = "waiting";
        job.state.lockedBy = undefined;
        job.state.lockedUntil = undefined;
        job.state.error = "Job stalled (worker timeout)";
        this.insertWaiting(queue, job);

        this.log.warn(`Recovered stalled job ${jobId}, returning to waiting`, {
          queue,
          attempt: job.state.attempts,
        });
      } else {
        // No more retries
        job.state.status = "failed";
        job.state.failedAt = now;
        job.state.lockedBy = undefined;
        job.state.lockedUntil = undefined;
        job.state.error =
          "Job stalled (worker timeout) - max attempts exceeded";
        this.failed.get(queue)!.unshift(jobId);

        this.log.warn(`Stalled job ${jobId} permanently failed`, {
          queue,
          attempts: job.state.attempts,
        });
      }
    }

    if (stalledJobIds.length > 0) {
      this.notifyJobWaiters(queue);
    }

    return stalledJobIds;
  }

  public async cleanJobs(
    queue: string,
    status: "completed" | "failed",
    options?: QueueCleanOptions,
  ): Promise<number> {
    const jobsList =
      status === "completed"
        ? this.completed.get(queue)
        : this.failed.get(queue);

    if (!jobsList || jobsList.length === 0) return 0;

    const jobsMap = this.jobs.get(queue);
    if (!jobsMap) return 0;

    const now = Date.now();
    const maxAge = options?.maxAge;
    const maxCount = options?.maxCount;

    let removed = 0;

    // Remove by age
    if (maxAge !== undefined) {
      const cutoff = now - maxAge;
      const toRemove: string[] = [];

      for (const jobId of jobsList) {
        const job = jobsMap.get(jobId);
        if (job) {
          const timestamp =
            status === "completed" ? job.state.completedAt : job.state.failedAt;
          if (timestamp && timestamp < cutoff) {
            toRemove.push(jobId);
          }
        }
      }

      for (const jobId of toRemove) {
        const idx = jobsList.indexOf(jobId);
        if (idx !== -1) {
          jobsList.splice(idx, 1);
          jobsMap.delete(jobId);
          removed++;
        }
      }
    }

    // Remove by count (keep only maxCount newest)
    if (maxCount !== undefined && jobsList.length > maxCount) {
      const toRemove = jobsList.splice(maxCount);
      for (const jobId of toRemove) {
        jobsMap.delete(jobId);
        removed++;
      }
    }

    return removed;
  }

  public async removeJob(queue: string, jobId: string): Promise<void> {
    const job = this.jobs.get(queue)?.get(jobId);
    if (!job) return;

    // Remove from appropriate list based on status
    switch (job.state.status) {
      case "waiting": {
        const list = this.waiting.get(queue);
        const idx = list?.indexOf(jobId) ?? -1;
        if (idx !== -1) list!.splice(idx, 1);
        break;
      }
      case "delayed": {
        const list = this.delayed.get(queue);
        const idx = list?.indexOf(jobId) ?? -1;
        if (idx !== -1) list!.splice(idx, 1);
        break;
      }
      case "active":
        this.active.get(queue)?.delete(jobId);
        break;
      case "completed": {
        const list = this.completed.get(queue);
        const idx = list?.indexOf(jobId) ?? -1;
        if (idx !== -1) list!.splice(idx, 1);
        break;
      }
      case "failed": {
        const list = this.failed.get(queue);
        const idx = list?.indexOf(jobId) ?? -1;
        if (idx !== -1) list!.splice(idx, 1);
        break;
      }
    }

    this.jobs.get(queue)?.delete(jobId);
  }

  public cancelWaiters(): void {
    // Cancel all job waiters
    for (const waiter of this.jobWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(undefined);
    }
    this.jobWaiters.clear();

    // Cancel all message waiters
    for (const waiter of this.messageWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(undefined as never);
    }
    this.messageWaiters.clear();
  }
}
