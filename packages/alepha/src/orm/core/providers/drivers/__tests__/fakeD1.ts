import type {
  D1Database,
  D1DatabaseSession,
  D1ExecResult,
  D1PreparedStatement,
  D1Result,
  D1SessionBookmark,
  D1SessionConstraint,
} from "../../../interfaces/D1Database.ts";

/**
 * Fakes for the D1 binding, shared by the timeout and session specs.
 *
 * A hand-written fake rather than a mocking library: the binding surface is
 * four methods, and the project substitutes real implementations through DI
 * instead of reaching for `vi.mock`.
 */

/**
 * Never settles, standing in for a stalled D1 primary.
 */
export const stall = () => new Promise<never>(() => {});

export const result = <T>(rows: T[]): D1Result<T> => ({
  results: rows,
  success: true,
  meta: {
    duration: 1,
    changes: 0,
    last_row_id: 0,
    served_by: "fake",
    internal_stats: null,
  },
});

export class FakeStatement implements D1PreparedStatement {
  public readonly bound: unknown[];
  protected readonly outcome: () => Promise<any>;
  protected readonly onExecute: (bound: unknown[]) => void;

  constructor(
    outcome: () => Promise<any>,
    onExecute: (bound: unknown[]) => void = () => {},
    bound: unknown[] = [],
  ) {
    this.outcome = outcome;
    this.onExecute = onExecute;
    this.bound = bound;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new FakeStatement(this.outcome, this.onExecute, [
      ...this.bound,
      ...values,
    ]);
  }

  first<T>(): Promise<T | null> {
    this.onExecute(this.bound);
    return this.outcome();
  }

  run(): Promise<D1Result> {
    this.onExecute(this.bound);
    return this.outcome();
  }

  all<T>(): Promise<D1Result<T>> {
    this.onExecute(this.bound);
    return this.outcome();
  }

  raw<T>(): Promise<T[]> {
    this.onExecute(this.bound);
    return this.outcome();
  }
}

export class FakeD1 implements D1Database {
  public readonly prepared: string[] = [];
  /**
   * Values carried by each statement at the moment it actually ran.
   */
  public readonly executed: unknown[][] = [];
  /**
   * Every constraint or bookmark `withSession` was opened with.
   */
  public readonly sessions: Array<
    (D1SessionBookmark & {}) | D1SessionConstraint | undefined
  > = [];
  /**
   * Flip to make subsequent calls hang, simulating a primary that stalls.
   */
  public stalling = false;
  /**
   * What `getBookmark()` reports on sessions handed out from here.
   */
  public bookmark: D1SessionBookmark | null = null;

  protected readonly outcome: () => Promise<any>;

  constructor(outcome: () => Promise<any> = async () => result([])) {
    this.outcome = outcome;
  }

  protected settle = (): Promise<any> =>
    this.stalling ? stall() : this.outcome();

  prepare(query: string): D1PreparedStatement {
    this.prepared.push(query);
    return new FakeStatement(this.settle, (bound) => this.executed.push(bound));
  }

  batch<T>(): Promise<T[]> {
    return this.settle();
  }

  exec(): Promise<D1ExecResult> {
    return this.settle();
  }

  dump(): Promise<ArrayBuffer> {
    return this.settle();
  }

  /**
   * A property rather than a method so a subclass can remove it entirely and
   * model a `workerd` build that predates the Sessions API.
   */
  public withSession?: (
    constraintOrBookmark?: (D1SessionBookmark & {}) | D1SessionConstraint,
  ) => D1DatabaseSession = (constraintOrBookmark) => {
    this.sessions.push(constraintOrBookmark);
    return {
      prepare: (query: string) => this.prepare(query),
      batch: <T>() => this.batch<T>(),
      getBookmark: () => this.bookmark,
    };
  };
}

/**
 * A binding with no `withSession`, standing in for an older `workerd` build.
 * Session support has to degrade to the primary rather than crash.
 */
export class FakeD1WithoutSessions extends FakeD1 {
  public override withSession = undefined;
}
