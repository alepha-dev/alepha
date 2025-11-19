import { AlephaError } from "../../core/errors/AlephaError.ts";
import type { Activity } from "../descriptors/$activity.ts";
import type { Duration } from "../descriptors/$workflow.ts";

/**
 * Deterministic execution context for workflows.
 *
 * This context ensures workflows execute deterministically by:
 * - Using event-sourced time instead of system time
 * - Providing seeded random number generation
 * - Recording all activities and signals as events
 * - Preventing direct I/O operations
 */
export class WorkflowContext<TInput = any> {
  // Workflow metadata (public as per interface)
  public readonly workflowId: string;
  public readonly runId: string;
  public readonly input: TInput;

  // State management
  public readonly state: Record<string, any> = {};

  protected readonly currentTime: Date;
  protected readonly seed: number;
  protected randomState: number;
  protected readonly pendingActivities: Map<string, any> = new Map();
  protected readonly pendingSignals: Map<string, any> = new Map();
  protected readonly memoCache: Map<string, any> = new Map();
  protected readonly compensationHandlers: Array<() => Promise<void>> = [];

  constructor(
    workflowId: string,
    runId: string,
    input: TInput,
    startedAt: Date,
  ) {
    this.workflowId = workflowId;
    this.runId = runId;
    this.input = input;
    this.currentTime = startedAt;

    // Create seed from workflow ID for deterministic random
    this.seed = this.hashString(workflowId);
    this.randomState = this.seed;
  }

  /**
   * Get current workflow time (deterministic).
   */
  public now(): Date {
    return new Date(this.currentTime);
  }

  /**
   * Generate deterministic random number.
   */
  public random(): number {
    // LCG (Linear Congruential Generator) for deterministic randomness
    this.randomState = (this.randomState * 1103515245 + 12345) & 0x7fffffff;
    return this.randomState / 0x7fffffff;
  }

  /**
   * Generate deterministic UUID.
   */
  public uuid(): string {
    // Generate deterministic UUID using workflow's random
    const hex = () => Math.floor(this.random() * 16).toString(16);
    return `${this.hex8()}-${this.hex4()}-4${this.hex3()}-${this.hex4()}-${this.hex12()}`;
  }

  /**
   * Wait for a signal to be delivered.
   */
  public async waitForSignal<T>(signal: any): Promise<T> {
    // Extract signal name from Atom or use as string
    const signalName = typeof signal === "string" ? signal : signal.key;

    // Check if signal already delivered
    if (this.pendingSignals.has(signalName)) {
      return this.pendingSignals.get(signalName);
    }

    // Signal not available yet - workflow will pause here
    throw new SignalNotAvailableError(signalName);
  }

  /**
   * Execute an activity.
   */
  public async activity<TInput, TOutput>(
    activity: Activity<any, TOutput>,
    input: TInput,
  ): Promise<TOutput> {
    const activityKey = `${activity.name}:${JSON.stringify(input)}`;

    // Check if activity result already recorded
    if (this.pendingActivities.has(activityKey)) {
      return this.pendingActivities.get(activityKey);
    }

    // Activity not executed yet - will be scheduled
    throw new ActivityNotExecutedError(activity.name, input);
  }

  /**
   * Sleep for a duration.
   */
  public async sleep(duration: Duration | number): Promise<void> {
    const durationObj =
      typeof duration === "number" ? { milliseconds: duration } : duration;
    // In event sourcing, sleep is recorded as an event
    // The workflow will resume after the duration
    throw new SleepRequestedError(durationObj);
  }

  /**
   * Timer for a duration (alias for sleep).
   */
  public async timer(duration: Duration): Promise<void> {
    return this.sleep(duration);
  }

  /**
   * Execute multiple promises in parallel.
   */
  public async parallel<T>(fn: () => Promise<T>[]): Promise<T[]> {
    const promises = fn();
    return Promise.all(promises);
  }

  /**
   * Race multiple promises.
   */
  public async race<T>(fn: () => Promise<T>[]): Promise<T> {
    const promises = fn();
    return Promise.race(promises);
  }

  /**
   * Execute a child workflow.
   */
  public async child<TChildInput, TChildOutput>(
    workflow: any,
    input: TChildInput,
  ): Promise<TChildOutput> {
    // TODO: Implement child workflow execution
    throw new AlephaError("Child workflows not yet implemented");
  }

  /**
   * Register a compensation handler for saga pattern.
   */
  public compensate(handler: () => Promise<void>): void {
    this.compensationHandlers.push(handler);
  }

  /**
   * Get registered compensation handlers (for internal use).
   */
  public getCompensationHandlers(): Array<() => Promise<void>> {
    return [...this.compensationHandlers];
  }

  /**
   * Send a signal to another workflow.
   */
  public async sendSignal<T>(
    workflowId: string,
    signal: any,
    payload: T,
  ): Promise<void> {
    // TODO: Implement signal sending to other workflows
    throw new AlephaError(
      "Sending signals to other workflows not yet implemented",
    );
  }

  /**
   * Create a human task and wait for completion.
   */
  public async humanTask<T>(taskType: string, data: any): Promise<T> {
    // TODO: Implement human task creation and waiting
    throw new AlephaError("Human tasks not yet implemented");
  }

  /**
   * Memoize a computation.
   */
  public async memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (this.memoCache.has(key)) {
      return this.memoCache.get(key);
    }
    const result = await fn();
    this.memoCache.set(key, result);
    return result;
  }

  /**
   * Deliver a signal to the workflow (internal use).
   */
  public deliverSignal<T>(signalName: string, payload: T): void {
    this.pendingSignals.set(signalName, payload);
  }

  /**
   * Record activity result (internal use).
   */
  public recordActivityResult<T>(
    activityName: string,
    input: any,
    result: T,
  ): void {
    const activityKey = `${activityName}:${JSON.stringify(input)}`;
    this.pendingActivities.set(activityKey, result);
  }

  protected hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  protected hex8(): string {
    return Array.from({ length: 8 }, () =>
      Math.floor(this.random() * 16).toString(16),
    ).join("");
  }

  protected hex4(): string {
    return Array.from({ length: 4 }, () =>
      Math.floor(this.random() * 16).toString(16),
    ).join("");
  }

  protected hex3(): string {
    return Array.from({ length: 3 }, () =>
      Math.floor(this.random() * 16).toString(16),
    ).join("");
  }

  protected hex12(): string {
    return Array.from({ length: 12 }, () =>
      Math.floor(this.random() * 16).toString(16),
    ).join("");
  }
}

/**
 * Error thrown when workflow waits for a signal that hasn't arrived yet.
 */
export class SignalNotAvailableError extends AlephaError {
  constructor(public readonly signalName: string) {
    super(`Signal ${signalName} not available yet`);
    this.name = "SignalNotAvailableError";
  }
}

/**
 * Error thrown when workflow attempts to execute an activity.
 */
export class ActivityNotExecutedError extends AlephaError {
  constructor(
    public readonly activityName: string,
    public readonly input: any,
  ) {
    super(`Activity ${activityName} not executed yet`);
    this.name = "ActivityNotExecutedError";
  }
}

/**
 * Error thrown when workflow requests to sleep.
 */
export class SleepRequestedError extends AlephaError {
  constructor(public readonly duration: Duration) {
    super(`Sleep requested for ${JSON.stringify(duration)}`);
    this.name = "SleepRequestedError";
  }
}
