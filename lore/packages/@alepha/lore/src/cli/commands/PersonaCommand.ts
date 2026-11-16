import type { PersonaController } from "@lore/plan-requirements/api";
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
 * `lore persona list | get | create | update | delete | comment add`: the
 * personas of Plan's Requirements (#E153), one command per MCP tool, each
 * over the existing actions.
 *
 * ```bash
 * lore persona create -p acme --name Léa --role "Shop manager" --kind human
 * lore persona get A2 -p acme
 * ```
 *
 * ⚠️ Never re-exported from `index.ts`: the controller type comes from a
 * private workspace.
 */
export class PersonaCommand {
  protected readonly client = $inject(LoreClientService);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly refs = $inject(LoreReferences);
  protected readonly refusals = $inject(LoreRefusals);
  protected readonly render = $inject(LoreOutput);

  /**
   * ⚠️ Declared after `client`: a field initializer reading a field declared
   * below it sees `undefined`.
   */
  protected readonly personaApi = $client<PersonaController>(
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
      "The persona: 2, A2 or '#A2'. Quote #A2: unquoted, a shell reads # as a comment.",
  });

  protected static readonly KIND = z.enum(["human", "system", "agent"]);

  /**
   * Every field a create or an update writes, as flags.
   */
  protected static readonly FIELDS = {
    kind: PersonaCommand.KIND.describe("human, system or agent.").optional(),
    role: z.text({ description: "One line: 'Shop manager'." }).optional(),
    who: z
      .text({
        size: "rich",
        atFile: true,
        description: "Who they are, in Markdown.",
      })
      .optional(),
    goals: z
      .text({
        size: "rich",
        atFile: true,
        description: "Their goals, in Markdown.",
      })
      .optional(),
    frustrations: z
      .text({
        size: "rich",
        atFile: true,
        description: "What gets in their way, in Markdown.",
      })
      .optional(),
    "alepha-role": z
      .text({
        description: "The $role or service account they play in the app.",
      })
      .optional(),
    "demo-account": z
      .text({ description: "The demo login. Never a password." })
      .optional(),
    "demo-seed": z
      .text({ description: "The seed's path in the app's repository." })
      .optional(),
    "environment-app": z
      .text({ description: "The app copy they live on: its app name." })
      .optional(),
    "environment-env": z
      .text({ description: "The app copy's environment: staging, production." })
      .optional(),
    area: z
      .text({ description: "Areas, comma-separated. Replaces the list." })
      .optional(),
  };

  protected bodyOf(flags: Record<string, unknown>) {
    const text = (key: string) =>
      typeof flags[key] === "string" ? (flags[key] as string) : undefined;
    const kind = text("kind") as "human" | "system" | "agent" | undefined;
    return {
      ...(kind ? { kind } : {}),
      ...(text("name") ? { name: text("name") } : {}),
      ...(text("role") !== undefined ? { role: text("role") } : {}),
      ...(text("who") !== undefined ? { who: text("who") } : {}),
      ...(text("goals") !== undefined ? { goals: text("goals") } : {}),
      ...(text("frustrations") !== undefined
        ? { frustrations: text("frustrations") }
        : {}),
      ...(text("alepha-role") !== undefined
        ? { alephaRole: text("alepha-role") }
        : {}),
      ...(text("demo-account") !== undefined
        ? { demoAccount: text("demo-account") }
        : {}),
      ...(text("demo-seed") !== undefined
        ? { demoSeed: text("demo-seed") }
        : {}),
      ...(text("environment-app") !== undefined
        ? { environmentApp: text("environment-app") }
        : {}),
      ...(text("environment-env") !== undefined
        ? { environmentEnv: text("environment-env") }
        : {}),
      ...(text("area") !== undefined
        ? {
            areas: (text("area") ?? "")
              .split(",")
              .map((it) => it.trim())
              .filter(Boolean),
          }
        : {}),
    };
  }

  public readonly list = $command({
    name: "list",
    description: "List a project's personas",
    flags: z.object({
      ...PersonaCommand.PROJECT_FLAG,
      kind: PersonaCommand.KIND.describe(
        "Only personas of this kind.",
      ).optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const personas = await this.personaApi.getPersonas({
          params: { projectId },
          query: flags.kind ? { kind: flags.kind } : {},
        });
        if (flags.output === "json") {
          this.render.json(print, personas);
          return;
        }
        this.render.list(
          print,
          personas.map((it) => ({
            handle: `A${it.number}`,
            title: it.name,
            fields: [it.kind, it.role],
          })),
          undefined,
          "This project has no personas.",
        );
      });
    },
  });

  public readonly get = $command({
    name: "get",
    description:
      "Show one persona: who they are, their goals, their demo account and their discussion",
    args: PersonaCommand.REF_ARG,
    flags: z.object({ ...PersonaCommand.PROJECT_FLAG, ...LoreOutput.FLAGS }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.persona(args);
        const { projectId } = await this.projects.named(flags.project, context);
        const [persona, comments] = await Promise.all([
          this.personaApi.getPersonaByNumber({ params: { projectId, number } }),
          this.personaApi.getPersonaComments({ params: { projectId, number } }),
        ]);
        if (flags.output === "json") {
          this.render.json(print, { ...persona, comments });
          return;
        }
        this.render.entity(print, {
          fields: [
            ["persona", `A${persona.number} ${persona.name}`],
            ["kind", persona.kind],
            ["role", persona.role],
            ["alepha role", persona.alephaRole],
            ["demo account", persona.demoAccount],
            ["demo seed", persona.demoSeed],
            [
              "environment",
              persona.environmentApp
                ? `${persona.environmentApp}/${persona.environmentEnv ?? ""}`
                : undefined,
            ],
            ["areas", persona.areas.join(", ")],
          ],
          sections: [
            { title: "Who", lines: persona.who ? [persona.who] : [] },
            { title: "Goals", lines: persona.goals ? [persona.goals] : [] },
            {
              title: "Frustrations",
              lines: persona.frustrations ? [persona.frustrations] : [],
            },
            {
              title: "Discussion",
              lines: comments.flatMap((it) => [
                `${it.createdAt}${it.byAgent ? `  (agent${it.agentClient ? `: ${it.agentClient}` : ""})` : ""}`,
                it.body,
              ]),
            },
          ].filter((section) => section.lines.length > 0),
        });
      });
    },
  });

  public readonly create = $command({
    name: "create",
    description: "Create a persona, numbered A<n> in its project",
    flags: z.object({
      ...PersonaCommand.PROJECT_FLAG,
      name: z.text({
        minLength: 1,
        maxLength: 80,
        description: "The persona's name.",
      }),
      ...PersonaCommand.FIELDS,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const { projectId } = await this.projects.named(flags.project, context);
        const created = await this.personaApi.createPersona({
          params: { projectId },
          body: { ...this.bodyOf(flags), name: flags.name },
        });
        this.render.written(
          print,
          flags.output,
          created,
          `Created A${created.number} ${created.name}`,
        );
      });
    },
  });

  public readonly update = $command({
    name: "update",
    description: "Change a persona; omitted flags stay as they are",
    args: PersonaCommand.REF_ARG,
    flags: z.object({
      ...PersonaCommand.PROJECT_FLAG,
      name: z
        .text({ minLength: 1, maxLength: 80, description: "A new name." })
        .optional(),
      ...PersonaCommand.FIELDS,
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.persona(args);
        const { projectId } = await this.projects.named(flags.project, context);
        const persona = await this.personaApi.getPersonaByNumber({
          params: { projectId, number },
        });
        const updated = await this.personaApi.updatePersona({
          params: { id: persona.id },
          body: this.bodyOf(flags),
        });
        this.render.written(
          print,
          flags.output,
          updated,
          `Updated A${updated.number} ${updated.name}`,
        );
      });
    },
  });

  public readonly delete = $command({
    name: "delete",
    description: "Delete a persona; its number is never reused",
    args: PersonaCommand.REF_ARG,
    flags: z.object({
      ...PersonaCommand.PROJECT_FLAG,
      yes: z
        .boolean()
        .describe("Required: deleting a persona cannot be undone from here.")
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.persona(args);
        if (!flags.yes) {
          throw new UsageError(
            `Deleting A${number} cannot be undone from here: pass --yes.`,
          );
        }
        const { projectId } = await this.projects.named(flags.project, context);
        const persona = await this.personaApi.getPersonaByNumber({
          params: { projectId, number },
        });
        await this.personaApi.deletePersona({ params: { id: persona.id } });
        this.render.written(
          print,
          flags.output,
          { ok: true, number },
          `Deleted A${number} ${persona.name}`,
        );
      });
    },
  });

  public readonly commentAdd = $command({
    name: "add",
    description: "Leave a comment on a persona",
    args: PersonaCommand.REF_ARG,
    flags: z.object({
      ...PersonaCommand.PROJECT_FLAG,
      body: z.text({
        size: "rich",
        atFile: true,
        description:
          "The comment, in Markdown. An @handle reaches that project member's inbox.",
      }),
      as: z
        .text({
          description:
            "Your name if you are an agent, e.g. claude-code: the comment shows as agent-written.",
        })
        .optional(),
      ...LoreOutput.FLAGS,
    }),
    handler: async ({ args, flags, print }) => {
      const context: LoreRefusalContext = {};
      await this.refusals.guard(context, async () => {
        const number = this.refs.persona(args);
        const { projectId } = await this.projects.named(flags.project, context);
        const persona = await this.personaApi.getPersonaByNumber({
          params: { projectId, number },
        });
        const comment = await this.personaApi.addPersonaComment({
          params: { id: persona.id },
          body: {
            body: flags.body,
            ...(flags.as ? { agent: true, agentClient: flags.as } : {}),
          },
        });
        this.render.written(
          print,
          flags.output,
          comment,
          `Commented on A${persona.number}`,
        );
      });
    },
  });

  public readonly comment = $command({
    name: "comment",
    description: "A persona's discussion: add a comment",
    children: [this.commentAdd],
    handler: async ({ help }) => {
      help();
    },
  });

  /**
   * ⚠️ Declared after its children: `CliProvider.findCommand` resolves by
   * `findLast`.
   */
  public readonly persona = $command({
    name: "persona",
    description:
      "A project's personas, the actors of Plan's Requirements: list, read, create, update, delete and comment on them",
    children: [
      this.list,
      this.get,
      this.create,
      this.update,
      this.delete,
      this.comment,
    ],
    handler: async ({ help }) => {
      help();
    },
  });
}
