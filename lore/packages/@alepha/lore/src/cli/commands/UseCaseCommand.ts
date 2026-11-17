import type {
  PersonaController,
  RequirementsPromptController,
  RunController,
  UseCaseController,
} from "@lore/plan-requirements/api";
import { $inject, z } from "alepha";
import { $command, UsageError } from "alepha/command";
import { $client } from "alepha/server/links";

import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreOutput } from "../services/LoreOutput.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import { LoreReferences } from "../services/LoreReferences.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * `lore usecase list | get | create | update | delete | comment add |
 * link epic`: the use cases of Plan's Requirements (#E153), one command per
 * MCP tool.
 *
 * The scenario's lists are written as text, each REPLACING the use case's
 * own when givenText:
 *
 * ```bash
 * lore usecase create -p acme --title "Check out" --actor A2,A3:beneficiary \
 *   --step @steps.txt --criteria @criteria.json
 * ```
 *
 * - `--actor A2,A3:beneficiary`: persona references, each with an optional
 *   role (primary by default);
 * - `--step`: one step per line, `A2: text` naming who acts it;
 * - `--alternative`: one per line, `4a: text`;
 * - `--criteria`: a JSON array, each `{ key?, givenText?, whenText?, thenText?, text?,
 *   method?, alternativeKey? }` (keep `key` to keep a criterion).
 *
 * ⚠️ Never re-exported from `index.ts`.
 */
export class UseCaseCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refs = $inject(LoreReferences);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  protected readonly useCaseApi = $client<UseCaseController>(
    this.client.scope(),
  );
  protected readonly personaApi = $client<PersonaController>(
    this.client.scope(),
  );
  protected readonly runApi = $client<RunController>(this.client.scope());
  protected readonly promptApi = $client<RequirementsPromptController>(
    this.client.scope(),
  );

  protected static readonly PROJECT_FLAG = {
    project: z
      .text({
        aliases: ["p"],
        description: "The project, by slug or id. Defaults to LORE_PROJECT.",
      })
      .optional(),
  };

  protected static readonly REF_ARG = z.text({
    title: "ref",
    description:
      "The use case: 7, U7 or '#U7'. Quote #U7: unquoted, a shell reads # as a comment.",
  });

  protected static readonly FIELDS = {
    status: z
      .enum(["draft", "ready", "deprecated"])
      .describe(
        "draft, ready or deprecated. Validation is lore usecase validate's.",
      )
      .optional(),
    priority: z
      .enum(["low", "medium", "high"])
      .describe("low, medium or high.")
      .optional(),
    preconditions: z
      .text({
        size: "rich",
        atFile: true,
        description: "What holds before, in Markdown.",
      })
      .optional(),
    "starting-data": z
      .text({ description: "The seed path run first." })
      .optional(),
    "automated-test-path": z
      .text({ description: "The e2e spec playing it." })
      .optional(),
    "automated-test-tag": z.text({ description: "Its tag, @U7." }).optional(),
    actor: z
      .text({
        description: "Who plays it: A2,A3:beneficiary. Replaces the list.",
      })
      .optional(),
    step: z
      .text({
        size: "rich",
        atFile: true,
        description:
          "The steps, one per line; 'A2: text' names who acts it. Replaces the list.",
      })
      .optional(),
    alternative: z
      .text({
        size: "rich",
        atFile: true,
        description:
          "Alternatives, one per line: '4a: text'. Replaces the list.",
      })
      .optional(),
    criteria: z
      .text({
        size: "rich",
        atFile: true,
        description:
          "Criteria as a JSON array of { key?, givenText?, whenText?, thenText?, text?, method?, alternativeKey? }. Replaces the list.",
      })
      .optional(),
  };

  /**
   * The scenario flags as the actions take them, persona references turned
   * into ids.
   */
  protected async bodyOf(
    projectId: number,
    flags: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const text = (key: string) =>
      typeof flags[key] === "string" ? (flags[key] as string) : undefined;
    const ids = new Map<number, number>();
    const persona = async (ref: string): Promise<number> => {
      if (ids.size === 0) {
        const all = await this.personaApi.getPersonas({
          params: { projectId },
          query: {},
        });
        for (const it of all) ids.set(it.number, it.id);
      }
      const number = this.refs.persona(ref);
      const id = ids.get(number);
      if (id === undefined) {
        throw new UsageError(`No persona A${number} in this project.`);
      }
      return id;
    };

    const body: Record<string, unknown> = {};
    if (text("status")) body.status = text("status");
    if (text("priority")) body.priority = text("priority");
    if (text("preconditions") !== undefined)
      body.preconditions = text("preconditions");
    if (text("starting-data") !== undefined)
      body.startingData = text("starting-data");
    if (text("automated-test-path") !== undefined) {
      body.automatedTestPath = text("automated-test-path");
    }
    if (text("automated-test-tag") !== undefined) {
      body.automatedTestTag = text("automated-test-tag");
    }
    if (text("actor") !== undefined) {
      body.actors = [];
      for (const part of (text("actor") ?? "")
        .split(",")
        .map((it) => it.trim())
        .filter(Boolean)) {
        const [ref, role] = part.split(":");
        (body.actors as unknown[]).push({
          personaId: await persona(ref),
          ...(role ? { role } : {}),
        });
      }
    }
    if (text("step") !== undefined) {
      body.steps = [];
      for (const line of (text("step") ?? "")
        .split("\n")
        .map((it) => it.trim())
        .filter(Boolean)) {
        const match = /^(#?A\d+)\s*:\s*(.+)$/i.exec(line);
        (body.steps as unknown[]).push(
          match
            ? { actorPersonaId: await persona(match[1]), text: match[2] }
            : { text: line },
        );
      }
    }
    if (text("alternative") !== undefined) {
      body.alternatives = (text("alternative") ?? "")
        .split("\n")
        .map((it) => it.trim())
        .filter(Boolean)
        .map((line) => {
          const match = /^([^:]{1,10}):\s*(.+)$/.exec(line);
          if (!match) {
            throw new UsageError(
              `An alternative reads '4a: text', not '${line}'.`,
            );
          }
          return { key: match[1].trim(), text: match[2] };
        });
    }
    if (text("criteria") !== undefined) {
      try {
        body.criteria = JSON.parse(text("criteria") ?? "[]");
      } catch {
        throw new UsageError("--criteria takes a JSON array.");
      }
    }
    return body;
  }

  public readonly list = $command({
    name: "list",
    description: "List a project's use cases",
    flags: z.object({
      ...UseCaseCommand.PROJECT_FLAG,
      status: z
        .enum(["draft", "ready", "validated", "deprecated"])
        .describe("Only use cases in this status.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const rows = await this.useCaseApi.getUseCases({
          params: { projectId },
          query: flags.status ? { status: flags.status } : {},
        });
        if (flags.output === "json") {
          this.render.json(print, rows);
          return;
        }
        this.render.list(
          print,
          rows.map((it) => ({
            handle: `U${it.number}`,
            title: it.title,
            fields: [it.status, it.actors.map((a) => `A${a.number}`).join(",")],
          })),
          undefined,
          "This project has no use cases.",
        );
      });
    },
  });

  public readonly get = $command({
    name: "get",
    description:
      "Show one use case: actors, steps, alternatives, criteria and covering epics",
    args: UseCaseCommand.REF_ARG,
    flags: z.object({ ...UseCaseCommand.PROJECT_FLAG, ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.useCase(args);
        const { projectId } = await this.projects.named(flags.project, context);
        const [uc, comments] = await Promise.all([
          this.useCaseApi.getUseCaseByNumber({ params: { projectId, number } }),
          this.useCaseApi.getUseCaseComments({ params: { projectId, number } }),
        ]);
        if (flags.output === "json") {
          this.render.json(print, { ...uc, comments });
          return;
        }
        const who = new Map(
          uc.actors.map((a) => [a.personaId, `A${a.number}`]),
        );
        this.render.entity(print, {
          fields: [
            ["use case", `U${uc.number} ${uc.title}`],
            ["status", uc.status],
            ["priority", uc.priority],
            ["version", String(uc.scenarioVersion)],
            [
              "actors",
              uc.actors
                .map((a) => `A${a.number} ${a.name} (${a.role})`)
                .join(", "),
            ],
            ["covered by", uc.coveredBy.map((e) => `E${e.number}`).join(", ")],
            ["starting data", uc.startingData],
            ["automated test", uc.automatedTestPath],
          ],
          body: uc.preconditions || undefined,
          sections: [
            {
              title: "Steps",
              lines: uc.steps.map(
                (s) =>
                  `${s.position}. ${s.actorPersonaId ? `${who.get(s.actorPersonaId) ?? "?"}: ` : ""}${s.text}`,
              ),
            },
            {
              title: "Alternatives",
              lines: uc.alternatives.map((a) => `${a.key}. ${a.text}`),
            },
            {
              title: "Criteria",
              lines: uc.criteria.map(
                (c) =>
                  `${c.key} [${c.method}] ${c.text ?? [c.givenText && `Given ${c.givenText}`, c.whenText && `When ${c.whenText}`, c.thenText && `Then ${c.thenText}`].filter(Boolean).join(" ")}`,
              ),
            },
            {
              title: "Discussion",
              lines: comments.flatMap((it) => [it.createdAt, it.body]),
            },
          ].filter((section) => section.lines.length > 0),
        });
      });
    },
  });

  public readonly create = $command({
    name: "create",
    description: "Create a use case, as a draft",
    flags: z.object({
      ...UseCaseCommand.PROJECT_FLAG,
      title: z.text({
        minLength: 3,
        maxLength: 120,
        description: "The scenario, in one line.",
      }),
      ...UseCaseCommand.FIELDS,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const created = await this.useCaseApi.createUseCase({
          params: { projectId },
          body: {
            ...(await this.bodyOf(projectId, flags)),
            title: flags.title,
          } as never,
        });
        this.render.written(
          print,
          flags.output,
          created,
          `Created U${created.number} ${created.title}`,
        );
      });
    },
  });

  public readonly update = $command({
    name: "update",
    description: "Change a use case; each list given replaces its own",
    args: UseCaseCommand.REF_ARG,
    flags: z.object({
      ...UseCaseCommand.PROJECT_FLAG,
      title: z
        .text({ minLength: 3, maxLength: 120, description: "A new title." })
        .optional(),
      ...UseCaseCommand.FIELDS,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.useCase(args);
        const { projectId } = await this.projects.named(flags.project, context);
        const uc = await this.useCaseApi.getUseCaseByNumber({
          params: { projectId, number },
        });
        const body = await this.bodyOf(projectId, flags);
        if (flags.title) body.title = flags.title;
        const updated = await this.useCaseApi.updateUseCase({
          params: { id: uc.id },
          body: body as never,
        });
        this.render.written(
          print,
          flags.output,
          updated,
          `Updated U${updated.number} ${updated.title}`,
        );
      });
    },
  });

  public readonly delete = $command({
    name: "delete",
    description: "Delete a use case; its number is never reused",
    args: UseCaseCommand.REF_ARG,
    flags: z.object({
      ...UseCaseCommand.PROJECT_FLAG,
      yes: z
        .boolean()
        .describe("Required: deleting a use case cannot be undone from here.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.useCase(args);
        if (!flags.yes) {
          throw new UsageError(
            `Deleting U${number} cannot be undone from here: pass --yes.`,
          );
        }
        const { projectId } = await this.projects.named(flags.project, context);
        const uc = await this.useCaseApi.getUseCaseByNumber({
          params: { projectId, number },
        });
        await this.useCaseApi.deleteUseCase({ params: { id: uc.id } });
        this.render.written(
          print,
          flags.output,
          { ok: true, number },
          `Deleted U${number} ${uc.title}`,
        );
      });
    },
  });

  public readonly commentAdd = $command({
    name: "add",
    description: "Leave a comment on a use case",
    args: UseCaseCommand.REF_ARG,
    flags: z.object({
      ...UseCaseCommand.PROJECT_FLAG,
      body: z.text({
        size: "rich",
        atFile: true,
        description:
          "The comment, in Markdown. An @handle reaches that project member's inbox.",
      }),
      as: z
        .text({
          description: "Your name if you are an agent, e.g. claude-code.",
        })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.useCase(args);
        const { projectId } = await this.projects.named(flags.project, context);
        const uc = await this.useCaseApi.getUseCaseByNumber({
          params: { projectId, number },
        });
        const comment = await this.useCaseApi.addUseCaseComment({
          params: { id: uc.id },
          body: {
            body: flags.body,
            ...(flags.as ? { agent: true, agentClient: flags.as } : {}),
          },
        });
        this.render.written(
          print,
          flags.output,
          comment,
          `Commented on U${uc.number}`,
        );
      });
    },
  });

  public readonly comment = $command({
    name: "comment",
    description: "A use case's discussion: add a comment",
    children: [this.commentAdd],
    handler: async ({ help }) => {
      help();
    },
  });

  public readonly linkEpic = $command({
    name: "epic",
    description: "Make an epic cover a use case, or stop with --no-linked",
    args: UseCaseCommand.REF_ARG,
    flags: z.object({
      ...UseCaseCommand.PROJECT_FLAG,
      epic: z.text({ description: "The epic: 12 or E12." }),
      linked: z
        .boolean()
        .describe("Cover (default) or, with --no-linked, stop covering.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.useCase(args);
        const epic = this.refs.epic(flags.epic);
        const { projectId } = await this.projects.named(flags.project, context);
        const uc = await this.useCaseApi.getUseCaseByNumber({
          params: { projectId, number },
        });
        const linked = flags.linked ?? true;
        const updated = await this.useCaseApi.linkUseCaseEpic({
          params: { id: uc.id },
          body: { epicNumber: epic, linked },
        });
        this.render.written(
          print,
          flags.output,
          updated,
          linked
            ? `E${epic} now covers U${number}`
            : `E${epic} no longer covers U${number}`,
        );
      });
    },
  });

  public readonly validate = $command({
    name: "validate",
    description:
      "Answer a use case's validation: validated, or changes_requested with a note",
    args: UseCaseCommand.REF_ARG,
    flags: z.object({
      ...UseCaseCommand.PROJECT_FLAG,
      decision: z
        .enum(["validated", "changes_requested"])
        .describe("validated, or changes_requested (back to draft)."),
      note: z
        .text({
          size: "rich",
          atFile: true,
          description: "Why, kept on the use case.",
        })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.useCase(args);
        const { projectId } = await this.projects.named(flags.project, context);
        const uc = await this.useCaseApi.getUseCaseByNumber({
          params: { projectId, number },
        });
        const updated = await this.useCaseApi.validateUseCase({
          params: { id: uc.id },
          body: { decision: flags.decision, note: flags.note },
        });
        this.render.written(
          print,
          flags.output,
          updated,
          `U${number} is ${updated.status === "validated" ? "validated" : "back to draft"}`,
        );
      });
    },
  });

  public readonly runRecord = $command({
    name: "record",
    description:
      "Record a run of a use case: one result per criterion, where it ran, and a note",
    args: UseCaseCommand.REF_ARG,
    flags: z.object({
      ...UseCaseCommand.PROJECT_FLAG,
      by: z
        .enum(["agent", "ci", "person"])
        .describe("Who played it: agent, ci or person."),
      client: z
        .text({ description: "Your name as a client: claude-code, github." })
        .optional(),
      app: z
        .text({ description: "The app copy played on. Omit for local." })
        .optional(),
      env: z
        .text({ description: "Its environment (staging), or local." })
        .optional(),
      note: z
        .text({
          size: "rich",
          atFile: true,
          description: "What the run saw, in Markdown.",
        })
        .optional(),
      result: z.text({
        description:
          "The results, comma-separated: C1=passed,C2=failed:shown €0,C3=not_run. A criterion left out is not run.",
      }),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.useCase(args);
        const { projectId } = await this.projects.named(flags.project, context);
        const results = flags.result
          .split(",")
          .map((it) => it.trim())
          .filter(Boolean)
          .map((part) => {
            const match =
              /^(C\d+)\s*=\s*(passed|failed|not_run)(?::(.*))?$/i.exec(part);
            if (!match) {
              throw new UsageError(
                `A result reads C2=passed or C2=failed:why, not '${part}'.`,
              );
            }
            return {
              key: match[1].toUpperCase(),
              result: match[2].toLowerCase() as "passed" | "failed" | "not_run",
              ...(match[3] ? { note: match[3].trim() } : {}),
            };
          });
        const recorded = await this.runApi.recordUseCaseRun({
          params: { projectId },
          body: {
            useCaseNumber: number,
            by: flags.by,
            client: flags.client,
            app: flags.app,
            env: flags.env,
            note: flags.note,
            results,
          },
        });
        this.render.written(
          print,
          flags.output,
          recorded,
          `Recorded run ${recorded.run.id} of U${number}${
            recorded.errorRule === "opened"
              ? `; ${recorded.errorsOpened} error(s) opened`
              : recorded.errorRule === "in_development"
                ? "; failures are in development (a covering quest is open)"
                : recorded.errorRule === "no_inbox"
                  ? "; failures show as Failing (the project tracks no errors)"
                  : ""
          }. Attach evidence: lore attachments push <file> --run ${recorded.run.id}`,
        );
      });
    },
  });

  public readonly run = $command({
    name: "run",
    description: "A use case's runs: record one",
    children: [this.runRecord],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * Prints the Verify prompt, the same text the dialog copies: it runs
   * nothing. Named `prompt`, not `run`: `lore usecase run record` records.
   */
  public readonly prompt = $command({
    name: "prompt",
    description:
      "Print the Verify prompt of a use case (test, spec, demo), a persona (--persona, explore) or a specification (--folio, import)",
    args: z
      .text({
        title: "ref",
        description:
          "The use case: 7 or U7, for the test, spec and demo modes.",
      })
      .optional(),
    flags: z.object({
      ...UseCaseCommand.PROJECT_FLAG,
      mode: z
        .enum(["test", "spec", "demo", "explore", "import"])
        .describe(
          "test, spec, demo, explore (with --persona) or import (with --folio).",
        ),
      persona: z
        .text({
          description: "A persona, A2: explore it, or test its use cases.",
        })
        .optional(),
      folio: z
        .text({ description: "The specification folio, F12, for import." })
        .optional(),
      stale: z
        .boolean()
        .describe("With --persona: only its stale use cases.")
        .optional(),
      app: z.text({ description: "The app copy to play on." }).optional(),
      env: z
        .text({ description: "Its environment (staging), or local." })
        .optional(),
      as: z.text({ description: "The persona to play: A2." }).optional(),
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const kind = {
          test: "useCaseTest",
          spec: "useCaseSpec",
          demo: "useCaseDemo",
          explore: "personaExplore",
          import: "requirementImport",
        }[flags.mode] as "useCaseTest";
        const rendered = await this.promptApi.renderRequirementsPrompt({
          params: { projectId },
          query: {
            kind,
            ...(args ? { useCaseNumber: this.refs.useCase(args) } : {}),
            ...(flags.persona
              ? { personaNumber: this.refs.persona(flags.persona) }
              : {}),
            ...(flags.folio
              ? { folioShortId: this.refs.folio(flags.folio) }
              : {}),
            ...(flags.stale ? { staleOnly: true } : {}),
            ...(flags.app ? { app: flags.app } : {}),
            ...(flags.env ? { env: flags.env } : {}),
            ...(flags.as ? { asPersona: this.refs.persona(flags.as) } : {}),
          },
        });
        print(rendered.prompt);
      });
    },
  });

  public readonly link = $command({
    name: "link",
    description: "Link a use case: epic",
    children: [this.linkEpic],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * ⚠️ Declared after its children: `CliProvider.findCommand` resolves by
   * `findLast`.
   */
  public readonly usecase = $command({
    name: "usecase",
    description:
      "A project's use cases, scenarios played by personas: list, read, create, update, delete, comment and link them to epics",
    children: [
      this.list,
      this.get,
      this.create,
      this.update,
      this.delete,
      this.comment,
      this.link,
      this.validate,
      this.run,
      this.prompt,
    ],
    handler: async ({ help }) => {
      help();
    },
  });
}
