import { $inject, AlephaError } from "alepha";
import { FileSystemProvider } from "alepha/system";

/**
 * Reads what `alepha test --coverage` wrote and turns it into what the Lore
 * endpoint takes.
 *
 * Both inputs are JSON that vitest emits natively, so there is no XML parser
 * anywhere in this epic and nothing here ever parses a filename or the HTML
 * report.
 */
export class QualityReportReader {
  /**
   * The convention, not a configurable path. `alepha test --coverage` writes
   * exactly here, and the whole point of that command owning the paths is that
   * this one needs no argument.
   */
  public static readonly COVERAGE_FILE = "coverage/coverage-summary.json";
  public static readonly TESTS_FILE = "coverage/test-results.json";

  protected readonly fs = $inject(FileSystemProvider);

  public async read(root: string): Promise<QualityReport> {
    const coverage = await this.readJson(
      root,
      QualityReportReader.COVERAGE_FILE,
    );
    const tests = await this.readJson(root, QualityReportReader.TESTS_FILE);

    return {
      coverage: {
        lines: this.pct(coverage, "lines"),
        statements: this.pct(coverage, "statements"),
        functions: this.pct(coverage, "functions"),
        branches: this.pct(coverage, "branches"),
      },
      tests: {
        total: this.count(tests, "numTotalTests"),
        passed: this.count(tests, "numPassedTests"),
        failed: this.count(tests, "numFailedTests"),
        // ⚠️ TWO sources, one column. `numPendingTests` is `.skip`,
        // `numTodoTests` is `.todo`, and both mean "did not run". Reading the
        // first alone under-reports by every todo in the suite.
        skipped:
          this.count(tests, "numPendingTests") +
          this.count(tests, "numTodoTests"),
      },
      durationMs: this.durationOf(tests),
      reports: { coverage, tests },
    };
  }

  /**
   * ⚠️ The vitest JSON report carries **no top-level duration**. Verified
   * against a real 4.1.10 run: `"duration" in report` is false.
   *
   * The furthest per-file `endTime` minus the run's own `startTime`, which is
   * the wall clock rather than the sum of the files - a suite that runs eight
   * files in parallel took as long as its slowest, not eight times as long.
   */
  protected durationOf(tests: Record<string, any>): number {
    const files: Array<{ endTime?: number }> = tests.testResults ?? [];
    const startTime = Number(tests.startTime ?? 0);
    const lastEnd = files.reduce(
      (furthest, file) => Math.max(furthest, Number(file.endTime ?? 0)),
      0,
    );

    // A report with no files, or one whose clock reads backwards, is a zero
    // rather than a negative: the column is `min(0)` and a negative duration
    // would be refused at the endpoint, turning a strange report into a failed
    // build.
    return Math.max(0, Math.round(lastEnd - startTime));
  }

  /**
   * A coverage percentage off the `total` block, which istanbul's
   * `json-summary` always writes even when nothing was covered.
   */
  protected pct(coverage: Record<string, any>, key: string): number {
    return Number(coverage.total?.[key]?.pct ?? 0);
  }

  protected count(tests: Record<string, any>, key: string): number {
    return Number(tests[key] ?? 0);
  }

  /**
   * ⚠️ The error here is the single most-hit surface of this whole epic:
   * someone runs the push without the run that produces its input. It names
   * the missing file AND the command that writes it, because "ENOENT" answers
   * neither question.
   */
  protected async readJson(
    root: string,
    relative: string,
  ): Promise<Record<string, any>> {
    const path = `${root}/${relative}`;
    let raw: string;
    try {
      raw = await this.fs.readTextFile(path);
    } catch {
      throw new AlephaError(
        `No ${relative} at ${path}. Run \`alepha test --coverage\` first: it writes both reports this command reads.`,
      );
    }

    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new AlephaError(
        `${relative} is not valid JSON (${path}). Re-run \`alepha test --coverage\`; a truncated report usually means the run was interrupted.`,
        { cause: error },
      );
    }
  }
}

/**
 * The totals a run measured, plus the reports they were read from.
 */
export interface QualityReport {
  coverage: {
    lines: number;
    statements: number;
    functions: number;
    branches: number;
  };
  tests: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  durationMs: number;
  reports: Record<string, any>;
}
