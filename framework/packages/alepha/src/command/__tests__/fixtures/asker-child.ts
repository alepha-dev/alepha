/**
 * A minimal program that asks the questions named on its command line, one
 * after the other, on the real `readline` over its real stdin.
 *
 * Spawned by Asker-stdin.spec.ts, which pipes the answers in. It reports each
 * answer, or the error a question threw, as one JSON line on stdout.
 *
 * `ASKER_WAIT_FOR_END=1` waits, after the first answer, until stdin has
 * ended: the case of a command that works for a while between two questions.
 */
import { once } from "node:events";

import { Alepha } from "alepha";

// Relative, not "alepha/command": see exclusive-child.ts.
import { NoInputError } from "../../errors/NoInputError.ts";
import { Asker } from "../../helpers/Asker.ts";

const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
const asker = alepha.inject(Asker);
const questions = process.argv.slice(2);
const answers: string[] = [];
let failure: { noInput: boolean; code?: string; message: string } | undefined;

try {
  for (const [index, question] of questions.entries()) {
    answers.push(await asker.ask.prompt(question));
    if (
      index === 0 &&
      process.env.ASKER_WAIT_FOR_END &&
      !process.stdin.readableEnded
    ) {
      await once(process.stdin, "end");
    }
  }
} catch (error) {
  failure = {
    noInput: error instanceof NoInputError,
    code: (error as { code?: string }).code,
    message: error instanceof Error ? error.message : String(error),
  };
}

asker.close();
process.stderr.write(`${JSON.stringify({ answers, failure })}\n`);
