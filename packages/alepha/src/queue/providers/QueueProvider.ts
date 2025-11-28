import type {
  QueueAcquiredJob,
  QueueCleanOptions,
  QueueGetJobsOptions,
  QueueJob,
  QueueJobCounts,
  QueueJobOptions,
  QueueJobStatus,
} from "../interfaces/QueueJob.ts";

/**
 * Queue provider interface supporting both simple message-based and advanced job-based operations.
 *
 * The simple API (push/pop/popBlocking) is for basic fire-and-forget messaging.
 * The job API provides crash recovery, retries, delayed jobs, priorities, and job history.
 */
export abstract class QueueProvider {
  // ===========================================
  // Simple Message API (backward compatible)
  // ===========================================

  /**
   * Push a message to the queue.
   *
   * @param queue Name of the queue to push the message to.
   * @param message String message to be pushed to the queue.
   */
  public abstract push(queue: string, message: string): Promise<void>;

  /**
   * Pop a message from the queue.
   *
   * @param queue Name of the queue to pop the message from.
   * @returns The message popped or `undefined` if the queue is empty.
   */
  public abstract pop(queue: string): Promise<string | undefined>;

  /**
   * Pop a message from one of the specified queues, blocking until available or timeout.
   *
   * @param queues Array of queue names to listen on.
   * @param timeoutSeconds Maximum time to wait in seconds.
   * @returns Object with queue name and message, or `undefined` if timeout expired.
   */
  public abstract popBlocking(
    queues: string[],
    timeoutSeconds: number,
  ): Promise<{ queue: string; message: string } | undefined>;

  // ===========================================
  // Job-based API (advanced features)
  // ===========================================

  /**
   * Add a job to the queue.
   *
   * @param queue Queue name.
   * @param payload Job data to process.
   * @param options Job options (priority, delay, retries, etc.).
   * @returns The created job.
   */
  public abstract addJob<T>(
    queue: string,
    payload: T,
    options?: QueueJobOptions,
  ): Promise<QueueJob<T>>;

  /**
   * Acquire the next available job for processing.
   *
   * This atomically:
   * 1. Finds the highest priority job that is ready for processing
   * 2. Moves it to "active" status
   * 3. Sets a lock with the worker ID
   *
   * @param queues Queue names to check (in order of preference).
   * @param workerId Unique identifier for the worker acquiring the job.
   * @param timeoutSeconds Maximum time to wait for a job.
   * @returns The acquired job or undefined if timeout.
   */
  public abstract acquireJob(
    queues: string[],
    workerId: string,
    timeoutSeconds: number,
  ): Promise<QueueAcquiredJob | undefined>;

  /**
   * Mark a job as completed successfully.
   *
   * @param queue Queue name.
   * @param jobId Job ID.
   * @param result Optional result data from processing.
   */
  public abstract completeJob(
    queue: string,
    jobId: string,
    result?: unknown,
  ): Promise<void>;

  /**
   * Mark a job as failed.
   *
   * If the job has remaining retry attempts, it will be moved to "delayed" status
   * (for backoff) or "waiting" status. Otherwise, it will be moved to "failed" status.
   *
   * @param queue Queue name.
   * @param jobId Job ID.
   * @param error Error message.
   * @param stackTrace Optional stack trace.
   */
  public abstract failJob(
    queue: string,
    jobId: string,
    error: string,
    stackTrace?: string,
  ): Promise<void>;

  /**
   * Extend the lock on an active job.
   *
   * Workers should call this periodically while processing long-running jobs
   * to prevent them from being considered stalled.
   *
   * @param queue Queue name.
   * @param jobId Job ID.
   * @param workerId Worker ID (must match the lock holder).
   * @returns True if lock was extended, false if job is not locked by this worker.
   */
  public abstract renewJobLock(
    queue: string,
    jobId: string,
    workerId: string,
  ): Promise<boolean>;

  /**
   * Get a job by ID.
   *
   * @param queue Queue name.
   * @param jobId Job ID.
   * @returns The job or undefined if not found.
   */
  public abstract getJob(
    queue: string,
    jobId: string,
  ): Promise<QueueJob | undefined>;

  /**
   * Get jobs by status.
   *
   * @param queue Queue name.
   * @param status Job status to filter by.
   * @param options Pagination options.
   * @returns Array of jobs.
   */
  public abstract getJobs(
    queue: string,
    status: QueueJobStatus,
    options?: QueueGetJobsOptions,
  ): Promise<QueueJob[]>;

  /**
   * Get job counts by status.
   *
   * @param queue Queue name.
   * @returns Object with counts for each status.
   */
  public abstract getJobCounts(queue: string): Promise<QueueJobCounts>;

  /**
   * Promote delayed jobs that are ready for processing.
   *
   * Moves jobs from "delayed" to "waiting" status when their availableAt time has passed.
   *
   * @param queue Queue name.
   * @returns Number of jobs promoted.
   */
  public abstract promoteDelayedJobs(queue: string): Promise<number>;

  /**
   * Recover stalled jobs.
   *
   * Finds jobs in "active" status whose locks have expired and either:
   * - Moves them back to "waiting" for retry (if attempts remaining)
   * - Moves them to "failed" (if no attempts remaining)
   *
   * @param queue Queue name.
   * @param stalledThresholdMs Jobs with expired locks older than this are considered stalled.
   * @returns Array of recovered job IDs.
   */
  public abstract recoverStalledJobs(
    queue: string,
    stalledThresholdMs: number,
  ): Promise<string[]>;

  /**
   * Remove old completed or failed jobs.
   *
   * @param queue Queue name.
   * @param status Status to clean ("completed" or "failed").
   * @param options Cleaning options (maxAge, maxCount).
   * @returns Number of jobs removed.
   */
  public abstract cleanJobs(
    queue: string,
    status: "completed" | "failed",
    options?: QueueCleanOptions,
  ): Promise<number>;

  /**
   * Remove a specific job.
   *
   * @param queue Queue name.
   * @param jobId Job ID.
   */
  public abstract removeJob(queue: string, jobId: string): Promise<void>;

  /**
   * Cancel all pending waiters.
   *
   * This is called during shutdown to immediately release all blocking
   * acquireJob calls, preventing shutdown delays.
   */
  public abstract cancelWaiters(): void;
}

// Re-export types for convenience
export type {
  QueueAcquiredJob,
  QueueAddJobOptions,
  QueueCleanOptions,
  QueueGetJobsOptions,
  QueueJob,
  QueueJobBackoff,
  QueueJobCounts,
  QueueJobOptions,
  QueueJobState,
  QueueJobStatus,
} from "../interfaces/QueueJob.ts";
