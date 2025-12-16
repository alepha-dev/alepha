/**
 * Represents a job in the queue system.
 *
 * Jobs are the core unit of work in the queue. They contain the payload to be processed,
 * options for controlling behavior (priority, retries, delays), and state tracking.
 */
export interface QueueJob<T = unknown> {
  /**
   * Unique identifier for the job.
   */
  id: string;

  /**
   * The queue this job belongs to.
   */
  queue: string;

  /**
   * The actual data to be processed.
   */
  payload: T;

  /**
   * Job configuration options.
   */
  options: QueueJobOptions;

  /**
   * Current state of the job.
   */
  state: QueueJobState;
}

/**
 * Options for configuring job behavior.
 */
export interface QueueJobOptions {
  /**
   * Job priority. Lower values = higher priority.
   * Jobs with lower priority values are processed first.
   *
   * @default 0
   */
  priority?: number;

  /**
   * Delay in milliseconds before the job becomes available for processing.
   * The job will be in "delayed" status until the delay expires.
   *
   * @default 0 (no delay)
   */
  delay?: number;

  /**
   * Maximum number of processing attempts before the job is marked as failed.
   * Includes the initial attempt.
   *
   * @default 1 (no retries)
   */
  maxAttempts?: number;

  /**
   * Backoff configuration for retries.
   * Controls the delay between retry attempts.
   */
  backoff?: QueueJobBackoff;

  /**
   * Maximum time in milliseconds a job can be processed before it's considered stalled.
   * If the worker doesn't complete or extend the lock within this time, the job
   * can be picked up by another worker.
   *
   * @default 30000 (30 seconds)
   */
  lockDuration?: number;

  /**
   * Automatically remove jobs when they complete successfully.
   * - `true`: Remove immediately after completion
   * - `false`: Keep in completed list (default)
   * - `number`: Keep this many most recent completed jobs, remove older ones
   *
   * @default false
   */
  removeOnComplete?: boolean | number;

  /**
   * Automatically remove jobs when they fail permanently (after all retries exhausted).
   * - `true`: Remove immediately after failure
   * - `false`: Keep in failed list (default)
   * - `number`: Keep this many most recent failed jobs, remove older ones
   *
   * @default false
   */
  removeOnFail?: boolean | number;
}

/**
 * Backoff configuration for job retries.
 */
export interface QueueJobBackoff {
  /**
   * Type of backoff strategy.
   * - "fixed": Same delay between all retries
   * - "exponential": Delay doubles with each retry
   */
  type: "fixed" | "exponential";

  /**
   * Base delay in milliseconds.
   * - For "fixed": The delay between all retries
   * - For "exponential": Initial delay, then multiplied by 2^attempt
   *
   * @default 1000
   */
  delay?: number;

  /**
   * Maximum delay in milliseconds (for exponential backoff).
   *
   * @default 30000
   */
  maxDelay?: number;
}

/**
 * Current state of a job.
 */
export interface QueueJobState {
  /**
   * Current status of the job.
   */
  status: QueueJobStatus;

  /**
   * Number of processing attempts made (starts at 0, incremented before each attempt).
   */
  attempts: number;

  /**
   * Worker ID that currently holds the lock on this job.
   * Only set when status is "active".
   */
  lockedBy?: string;

  /**
   * Timestamp (ms) when the current lock expires.
   * If processing isn't completed by this time, the job is considered stalled.
   */
  lockedUntil?: number;

  /**
   * Error message from the last failed attempt.
   */
  error?: string;

  /**
   * Stack trace from the last failed attempt.
   */
  stackTrace?: string;

  /**
   * Result returned by the handler on successful completion.
   */
  result?: unknown;

  /**
   * Timestamp (ms) when the job was created.
   */
  createdAt: number;

  /**
   * Timestamp (ms) when the job should become available for processing.
   * Used for delayed jobs.
   */
  availableAt?: number;

  /**
   * Timestamp (ms) when the job started processing (last attempt).
   */
  processedAt?: number;

  /**
   * Timestamp (ms) when the job completed successfully.
   */
  completedAt?: number;

  /**
   * Timestamp (ms) when the job failed (after all retries exhausted).
   */
  failedAt?: number;
}

/**
 * Possible statuses for a job.
 */
export type QueueJobStatus =
  | "waiting"
  | "delayed"
  | "active"
  | "completed"
  | "failed";

/**
 * Job counts by status.
 */
export type QueueJobCounts = Record<QueueJobStatus, number>;

/**
 * Options for adding a job to the queue.
 * Simplified version of QueueJobOptions for the public API.
 */
export interface QueueAddJobOptions {
  /**
   * Job priority. Lower values = higher priority.
   * @default 0
   */
  priority?: number;

  /**
   * Delay in milliseconds before processing.
   * @default 0
   */
  delay?: number;
}

/**
 * Result of acquiring a job for processing.
 */
export interface QueueAcquiredJob<T = unknown> {
  /**
   * The queue the job was acquired from.
   */
  queue: string;

  /**
   * The acquired job.
   */
  job: QueueJob<T>;
}

/**
 * Options for cleaning old jobs.
 */
export interface QueueCleanOptions {
  /**
   * Maximum age in milliseconds. Jobs older than this will be removed.
   */
  maxAge?: number;

  /**
   * Maximum number of jobs to keep. Oldest jobs beyond this count are removed.
   */
  maxCount?: number;
}

/**
 * Options for querying jobs.
 */
export interface QueueGetJobsOptions {
  /**
   * Maximum number of jobs to return.
   * @default 100
   */
  limit?: number;

  /**
   * Number of jobs to skip (for pagination).
   * @default 0
   */
  offset?: number;
}

// ===========================================
// Queue Events
// ===========================================

/**
 * Event types emitted by the queue system.
 */
export type QueueEventType =
  | "waiting"
  | "active"
  | "completed"
  | "failed"
  | "stalled"
  | "progress"
  | "retrying"
  | "removed";

/**
 * Base interface for all queue events.
 */
export interface QueueEventBase {
  /**
   * The queue name where the event occurred.
   */
  queue: string;

  /**
   * The job ID associated with the event.
   */
  jobId: string;

  /**
   * Timestamp when the event occurred.
   */
  timestamp: number;
}

/**
 * Event emitted when a job is added to the waiting queue.
 */
export interface QueueEventWaiting extends QueueEventBase {
  type: "waiting";
  /**
   * The job that was added.
   */
  job: QueueJob;
}

/**
 * Event emitted when a job starts processing.
 */
export interface QueueEventActive extends QueueEventBase {
  type: "active";
  /**
   * The worker ID that acquired the job.
   */
  workerId: string;
  /**
   * Current attempt number.
   */
  attempt: number;
}

/**
 * Event emitted when a job completes successfully.
 */
export interface QueueEventCompleted extends QueueEventBase {
  type: "completed";
  /**
   * The result returned by the job handler.
   */
  result?: unknown;
  /**
   * Total processing time in milliseconds.
   */
  duration: number;
}

/**
 * Event emitted when a job fails permanently (all retries exhausted).
 */
export interface QueueEventFailed extends QueueEventBase {
  type: "failed";
  /**
   * The error message.
   */
  error: string;
  /**
   * The stack trace if available.
   */
  stackTrace?: string;
  /**
   * Number of attempts made.
   */
  attempts: number;
}

/**
 * Event emitted when a job is detected as stalled.
 */
export interface QueueEventStalled extends QueueEventBase {
  type: "stalled";
  /**
   * The worker ID that was processing the job.
   */
  workerId?: string;
  /**
   * Whether the job will be retried.
   */
  willRetry: boolean;
}

/**
 * Event emitted when a job reports progress.
 */
export interface QueueEventProgress extends QueueEventBase {
  type: "progress";
  /**
   * Progress data (0-100 or custom object).
   */
  progress: number | Record<string, unknown>;
}

/**
 * Event emitted when a job is being retried after a failure.
 */
export interface QueueEventRetrying extends QueueEventBase {
  type: "retrying";
  /**
   * The error from the previous attempt.
   */
  error: string;
  /**
   * The attempt number that will be made.
   */
  attempt: number;
  /**
   * Delay in milliseconds before retry.
   */
  delay: number;
}

/**
 * Event emitted when a job is removed from the queue.
 */
export interface QueueEventRemoved extends QueueEventBase {
  type: "removed";
  /**
   * The status the job was in when removed.
   */
  previousStatus: QueueJobStatus;
}

/**
 * Union type of all queue events.
 */
export type QueueEvent =
  | QueueEventWaiting
  | QueueEventActive
  | QueueEventCompleted
  | QueueEventFailed
  | QueueEventStalled
  | QueueEventProgress
  | QueueEventRetrying
  | QueueEventRemoved;

/**
 * Handler function for queue events.
 */
export type QueueEventHandler<T extends QueueEvent = QueueEvent> = (
  event: T,
) => void | Promise<void>;

/**
 * Map of event types to their corresponding event interfaces.
 */
export interface QueueEventMap {
  waiting: QueueEventWaiting;
  active: QueueEventActive;
  completed: QueueEventCompleted;
  failed: QueueEventFailed;
  stalled: QueueEventStalled;
  progress: QueueEventProgress;
  retrying: QueueEventRetrying;
  removed: QueueEventRemoved;
}
