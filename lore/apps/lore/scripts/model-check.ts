/**
 * The assistant's model check (#Q3213): a fixed set of prompts, run against
 * Lore's finished tool set on the REAL Workers AI, for each model named, and
 * scored. Never against production data: Lore boots in this process on an
 * in-memory database seeded with a fixture project.
 *
 *   CLOUDFLARE_ACCOUNT_ID=... AI_API_KEY="$(npx wrangler auth token)" \
 *     node --import tsx --import ./scripts/css-stub.mjs scripts/model-check.ts \
 *     @cf/mistralai/mistral-small-3.1-24b-instruct @cf/meta/llama-3.3-70b-instruct-fp8-fast
 *
 * `AlephaAiOpenai` reaches Workers AI over its OpenAI-compatible REST
 * endpoint, the same models the `ai` binding runs. Writes stop at their card:
 * nothing is approved. Prints a score table, and writes every transcript to
 * the file named by `MODEL_CHECK_OUT` when set.
 */
import { writeFile } from "node:fs/promises";

import { Alepha } from "alepha";
import type { AiMessage, AiTurnResult } from "alepha/ai";
import { AlephaAiOpenai } from "alepha/ai/openai";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";

import { LoreAiAssistant, LoreAssistant } from "../src/assistant/index.ts";
import { bootLore } from "../test/fixtures/bootLore.ts";
import {
  createTestEpic,
  createTestFolio,
  createTestMember,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "../test/fixtures/entities.ts";

interface Prompt {
  id: string;
  kind: string;
  text: string;
  /**
   * Tools any of which is a right first call. Empty: the right answer
   * calls nothing (or nothing past `searchDocs`).
   */
  expect: string[];
  /**
   * Arguments the right call carries, checked on the first expected call.
   */
  args?: (call: Record<string, unknown>) => boolean;
  /**
   * The turn must not touch another project, and must stop.
   */
  mustStop?: boolean;
  /**
   * What the turn must get right beyond the first call: a follow-up call, or
   * a fact the reply states. Counted under "right arguments".
   */
  answer?: (turn: {
    calls: Array<{ name: string; input: any }>;
    reply: string;
  }) => boolean;
  /**
   * The page the prompt is asked from, when it is not the project page.
   */
  context?: typeof context;
  /**
   * A brevity prompt (#Q3297): the reply has to end on its own, inside the
   * output cap, and stay under this many characters. Scored apart from the
   * twelve, so their total stays comparable from one run to the next.
   */
  maxChars?: number;
}

const models = process.argv.slice(2);
if (
  !models.length ||
  !process.env.CLOUDFLARE_ACCOUNT_ID ||
  !process.env.AI_API_KEY
) {
  console.error(
    "usage: CLOUDFLARE_ACCOUNT_ID=... AI_API_KEY=... node --import tsx scripts/model-check.ts <model>...",
  );
  process.exit(2);
}

const alepha = Alepha.create({
  env: {
    DATABASE_URL: ":memory:",
    SERVER_PORT: 0,
    LOG_LEVEL: "error",
    AI_ASSISTANT_ENABLED: "1",
    AI_BASE_URL: `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_MODEL: models[0],
  },
});
alepha
  .with(AlephaOrm)
  .with(AlephaServer)
  .with(AlephaSecurity)
  .with(AlephaApiUsers);
// Before `LoreAssistant`: the first provider substituted is the one used.
alepha.with(AlephaAiOpenai);
bootLore(alepha, ["api", "mcp"]);
alepha.with(LoreAssistant);
const entities = alepha.inject(TestEntityRepositories);
const assistant = alepha.inject(LoreAiAssistant).assistant;
await alepha.start();

// ---- the seeded projects ------------------------------------------------------------------------------------------

const acme = await createTestProject(alepha, { title: "Acme Web" });
const beta = await createTestProject(alepha, { title: "Beta Mobile" });
await createTestMember(alepha, beta, acme.createdBy, { rank: "owner" });
await entities.users.updateById(acme.createdBy, {
  roles: ["user"],
  email: "ada@example.app",
});
const user: UserAccountToken = {
  id: acme.createdBy,
  name: "Ada Lovelace",
  email: "ada@example.app",
  roles: ["user"],
};
for (const [name, description] of [
  ["web", "The browser app"],
  ["auth", "Sign-in, sessions and accounts"],
]) {
  await entities.areas.create({ projectId: acme.id, name, description });
}
const epic = await createTestEpic(alepha, acme, {
  title: "Offline mode",
  status: "in_progress",
});
const q1 = await createTestQuest(alepha, acme, {
  title: "Cache the quest list in IndexedDB",
  area: "web",
  epicId: epic.id,
});
const q2 = await createTestQuest(alepha, acme, {
  title: "Sync queued edits when back online",
  area: "web",
  epicId: epic.id,
  priority: "high",
});
const q3 = await createTestQuest(alepha, acme, {
  title: "Fix the login redirect loop",
  area: "auth",
});
// ⚠️ A folio is found through `searchText`, which the API fills on every save
// and this fixture writes past. Left empty, every search of the check found
// nothing, and the model was scored for saying so (the "miss" on the two-step
// read of 2026-11-09 was this, not the model).
const seedFolio = (title: string, content: string, summary = "") =>
  createTestFolio(alepha, acme, {
    title,
    summary,
    content,
    searchText: `${title} ${summary} ${content}`.toLowerCase(),
  });
await seedFolio(
  "Deployment runbook",
  "# Deployment runbook\n\nWe deploy from main through CI. Roll back with `wrangler rollback`. The database is migrated before the worker ships.",
);
await createTestQuest(alepha, beta, { title: "Push notifications on iOS" });
// Enough folios, each with a real summary, for a list of them to run past the
// output cap when the model recites every summary: the report of #Q3297.
const folioTopics = [
  "Authentication",
  "Billing",
  "Caching",
  "Database migrations",
  "Email delivery",
  "Feature flags",
  "Image uploads",
  "Job queue",
  "Localization",
  "Monitoring",
  "Notifications",
  "Offline sync",
  "Permissions",
  "Rate limiting",
  "Search indexing",
  "Webhooks",
];
for (const topic of folioTopics) {
  await seedFolio(
    `${topic}: decisions`,
    `# ${topic}\n\nThe decisions taken for ${topic.toLowerCase()}.`,
    `Decision record for ${topic.toLowerCase()}: what was chosen, the two alternatives that were rejected and why, the constraints that held at the time, the migration path from the previous design, and the open questions left for the next review of this part of the system.`,
  );
}

const context = {
  route: `/${acme.slug}`,
  page: "project",
  data: {
    projectId: acme.id,
    projectSlug: acme.slug,
    projectTitle: acme.title,
    language: "en",
    contentLanguage: "en",
  },
};

/**
 * What the prompt's list rules ask of a reply over sixteen matches: some
 * folios named, no summary recited, and a word that there are more. No count
 * is asked for: `folio_search` returns ten rows and no total, so a number
 * there would be invented.
 *
 * ⚠️ The five-item cap is NOT part of the pass: Mistral Small 3.1 followed it
 * in three runs of six (2026-11-10, #Q3297) and listed ten or twelve titles
 * in the others, at 170 output tokens at most. It is printed as `listed`, so
 * a model that follows it shows.
 */
const brief = (reply: string) => {
  const named = new Set(reply.match(/#F\d+/g) ?? []).size;
  return (
    named >= 3 &&
    !/alternatives that were rejected/i.test(reply) &&
    /\b(more|others?)\b/i.test(reply)
  );
};

const prompts: Prompt[] = [
  {
    id: "read-open",
    kind: "read",
    text: "What quests are still open?",
    expect: ["quest_list", "search"],
    // Three are open (todo): an answer of "none" read the wrong status.
    args: (call) => call.status === undefined || call.status === "todo",
    answer: (turn) => /login redirect|IndexedDB|queued edits/i.test(turn.reply),
  },
  {
    id: "read-get",
    kind: "read",
    text: `Show me quest #Q${q2.shortId}.`,
    expect: ["quest_get"],
    args: (call) => Number(call.shortId ?? call.id) === q2.shortId,
  },
  {
    id: "read-epics",
    kind: "read",
    text: "Which epics are in progress?",
    expect: ["getEpicRefs", "epic_get"],
  },
  {
    id: "read-two-step",
    kind: "two-step read",
    text: "What does our deployment runbook say about rolling back?",
    expect: ["folio_search", "search"],
    answer: (turn) =>
      turn.calls.some((call) => call.name === "folio_get") &&
      /wrangler rollback/i.test(turn.reply),
  },
  {
    id: "write-create",
    kind: "write",
    text: "File a quest in the web area titled 'Add a dark mode toggle'.",
    expect: ["quest_create"],
    args: (call) =>
      typeof call.title === "string" &&
      call.title.toLowerCase().includes("dark mode") &&
      call.area === "web",
  },
  {
    id: "write-comment",
    kind: "write",
    text: `Comment on #Q${q1.shortId}: "Blocked until the service worker lands."`,
    expect: ["quest_comment_add"],
    args: (call) =>
      Number(call.shortId ?? call.id) === q1.shortId && call.as === "lore-ai",
  },
  {
    id: "write-update",
    kind: "write",
    text: `Set the priority of #Q${q1.shortId} to high.`,
    expect: ["quest_update"],
    args: (call) => call.priority === "high",
  },
  {
    id: "write-complete",
    kind: "write",
    text: `Mark #Q${q2.shortId} as complete, with the note "Shipped in the last release."`,
    expect: ["quest_complete"],
  },
  {
    id: "write-folio",
    kind: "write",
    text: "Write a folio titled 'Offline mode decisions' saying we store edits in IndexedDB and replay them in order.",
    expect: ["folio_create"],
  },
  {
    id: "how-to",
    kind: "how-to",
    text: "How do I shelve an epic?",
    expect: ["searchDocs"],
  },
  {
    id: "cross-project",
    kind: "another project",
    text: "What is open in the Beta Mobile project?",
    expect: [],
    mustStop: true,
  },
  {
    id: "outside",
    kind: "outside Lore",
    text: "What is the weather in Paris tomorrow?",
    expect: [],
    mustStop: true,
  },
  {
    // Every seeded folio is titled "<topic>: decisions": the search returns
    // all sixteen with their summaries, which is the list the report ran past
    // the cap reciting.
    id: "brief-title",
    kind: "brevity",
    text: "Which folios are about decisions?",
    expect: ["folio_search", "search"],
    context: {
      ...context,
      route: `/${acme.slug}/folios`,
      page: "projectFolios",
    },
    answer: (turn) => brief(turn.reply),
    maxChars: 700,
  },
  {
    // The same sixteen, matched on their summaries this time.
    id: "brief-summary",
    kind: "brevity",
    text: "List the folios that mention a migration path.",
    expect: ["folio_search", "search"],
    answer: (turn) => brief(turn.reply),
    maxChars: 700,
  },
];

// ---- run and score -----------------------------------------------------------------------------------------------

const calls = (messages: AiMessage[]) =>
  messages.flatMap((message) =>
    message.role === "assistant" ? (message.toolCalls ?? []) : [],
  );

const report: Array<Record<string, unknown>> = [];
// `MODEL_CHECK_ONLY=brevity` runs one kind, for iterating on a prompt rule.
const only = process.env.MODEL_CHECK_ONLY;
for (const model of models) {
  assistant.options.model = model;
  for (const prompt of prompts) {
    if (only && prompt.kind !== only) continue;
    let result: AiTurnResult | undefined;
    let failure: string | undefined;
    try {
      result = await assistant.run({
        messages: [{ role: "user", content: prompt.text }],
        user,
        context: prompt.context ?? context,
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    const made = result ? calls(result.messages) : [];
    const projects = made
      .map(
        (call) => call.input.project ?? (call.input.params as any)?.projectId,
      )
      .filter((it) => it !== undefined);
    const first = made.find((call) => prompt.expect.includes(call.name));
    const rightTool = prompt.expect.length
      ? first !== undefined
      : made.every((call) => call.name === "searchDocs");
    const reply = result?.text ?? "";
    const rightArgs =
      (prompt.args ? !!first && prompt.args(first.input) : rightTool) &&
      (prompt.answer ? prompt.answer({ calls: made, reply }) : true);
    const staysInProject = projects.every((id) => Number(id) === acme.id);
    const existing = new Set([q1.shortId, q2.shortId, q3.shortId]);
    const invented = made.some((call) => {
      const shortId = call.input.shortId;
      return (
        typeof shortId === "number" &&
        call.name !== "quest_create" &&
        !existing.has(shortId)
      );
    });
    const stops = prompt.mustStop ? made.length === 0 || staysInProject : true;
    // A turn that failed (the endpoint refused it, a malformed tool call)
    // did nothing right, whatever it did not do wrong.
    const score = failure
      ? 0
      : Number(rightTool) +
        Number(rightArgs) +
        Number(!invented) +
        Number(staysInProject) +
        Number(stops);
    // A brevity prompt passes when the reply answers (it names folios), ended
    // on its own and is short: "there are none" is short too, and wrong.
    const brief =
      prompt.maxChars === undefined
        ? undefined
        : !failure &&
          result?.reason !== "length" &&
          rightArgs &&
          reply.length <= prompt.maxChars;
    report.push({
      model,
      brief,
      reason: result?.reason,
      outputTokens: result?.usage.outputTokens,
      replyChars: reply.length,
      listed: new Set(reply.match(/#[QEF]\d+/g) ?? []).size,
      prompt: prompt.id,
      kind: prompt.kind,
      score,
      rightTool,
      rightArgs,
      noInventedId: !invented,
      staysInProject,
      stops,
      pending: result?.pending?.name,
      calls: made.map((call) => ({ name: call.name, input: call.input })),
      reply: result?.text,
      failure,
    });
    console.log(
      `${model.padEnd(48)} ${prompt.id.padEnd(16)} ${
        brief === undefined ? `${score}/5` : brief ? "brief" : "LONG"
      } ${String(result?.reason ?? "-").padEnd(7)} ${String(result?.usage.outputTokens ?? "-").padStart(5)} tok ${String(reply.length).padStart(5)} chars${failure ? ` FAILED ${failure.slice(0, 120)}` : ""}`,
    );
  }
}

const scored = prompts.filter((prompt) => prompt.maxChars === undefined);
const totals = models.map((model) => {
  const rows = report.filter((row) => row.model === model);
  return {
    model,
    total: rows
      .filter((row) => row.brief === undefined)
      .reduce((sum, row) => sum + Number(row.score), 0),
    of: scored.length * 5,
    brief: `${rows.filter((row) => row.brief === true).length}/${
      rows.filter((row) => row.brief !== undefined).length
    }`,
    cutAtTheCap: rows.filter((row) => row.reason === "length").length,
    maxOutputTokens: Math.max(
      0,
      ...rows.map((row) => Number(row.outputTokens ?? 0)),
    ),
  };
});
console.table(totals);
if (process.env.MODEL_CHECK_OUT) {
  await writeFile(process.env.MODEL_CHECK_OUT, JSON.stringify(report, null, 2));
}
await alepha.stop();
