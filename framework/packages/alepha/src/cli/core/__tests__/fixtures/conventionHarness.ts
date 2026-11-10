import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";

import { AlephaCliServices } from "../../index.ts";
import {
  type ConventionReport,
  ConventionRunner,
} from "../../services/ConventionRunner.ts";

/**
 * Write `files` under `/app` on a `MemoryFileSystemProvider` and run the
 * convention rules over it: `rule` alone, so another rule's finding never
 * lands in an assertion about this one.
 */
export const checkFiles = async (
  files: Record<string, string>,
  rule: string,
  configure?: (alepha: Alepha) => void,
): Promise<ConventionReport> => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } }).with({
    provide: FileSystemProvider,
    use: MemoryFileSystemProvider,
  });
  // Before the module: a substitution made after it is refused.
  configure?.(alepha);
  alepha.with(AlephaCliServices);
  const fs = alepha.inject(MemoryFileSystemProvider);
  for (const [path, content] of Object.entries(files)) {
    const absolute = `/app/${path}`;
    await fs.mkdir(absolute.slice(0, absolute.lastIndexOf("/")), {
      recursive: true,
    });
    await fs.writeFile(absolute, content);
  }
  return alepha.inject(ConventionRunner).run({ root: "/app", rules: [rule] });
};

/**
 * `[line, rule]` of every finding, the shape most assertions want.
 */
export const lines = (report: ConventionReport): Array<[number, string]> =>
  report.findings.map((finding) => [finding.line, finding.rule]);
