import { projectParamsSchema } from "@lore/core/schemas";
import { z } from "alepha";

const stackNameSchema = z
  .string()
  .min(1)
  .max(64)
  .describe("The stack's name, as `stack_list` returns it (`umami`, `mcs`).");

const envNameSchema = z
  .string()
  .min(1)
  .max(64)
  .describe(
    "The stack environment (`production`, `staging`), as `stack_list` returns it.",
  );

const environmentSummarySchema = z.object({
  env: z.string(),
  estateId: z
    .string()
    .optional()
    .describe(
      "The environment's own estate, when it overrides the stack's default.",
    ),
  baseDomain: z.string().optional(),
  revision: z
    .integer()
    .optional()
    .describe(
      "The revision last applied here; absent before the first deploy.",
    ),
  routes: z.array(z.object({ service: z.string(), domain: z.string() })),
  members: z
    .array(z.object({ app: z.string(), env: z.string() }))
    .describe("The app instances deployed into it."),
});

// -----------------------------------------------------------------------------
// stack_list
// -----------------------------------------------------------------------------

export const stackListParamsSchema = projectParamsSchema;

export const stackListResultSchema = z.object({
  stacks: z.array(
    z.object({
      name: z.string(),
      estateId: z
        .string()
        .optional()
        .describe("The default estate its environments deploy to."),
      latestRevision: z.integer().optional(),
      environments: z.array(environmentSummarySchema),
    }),
  ),
});

// -----------------------------------------------------------------------------
// stack_get
// -----------------------------------------------------------------------------

export const stackGetParamsSchema = projectParamsSchema.extend({
  stack: stackNameSchema,
  env: envNameSchema
    .optional()
    .describe(
      "Narrow to one environment, with its services and its last deploys.",
    ),
});

export const stackGetResultSchema = z.object({
  name: z.string(),
  latestRevision: z.integer().optional(),
  environments: z.array(
    environmentSummarySchema.extend({
      services: z
        .array(
          z.object({
            name: z.string(),
            kind: z
              .string()
              .describe(
                "`app` (deployed from an artifact) or `service` (run from its image).",
              ),
            app: z.string().optional(),
            image: z.string().optional(),
          }),
        )
        .describe(
          "The services of the revision applied here, from the stack model.",
        ),
      deploys: z
        .array(
          z.object({
            id: z.string(),
            revision: z.integer(),
            status: z.string(),
            error: z.string().optional(),
            createdAt: z.string(),
          }),
        )
        .describe("The newest stack deploys of this environment."),
    }),
  ),
});

// -----------------------------------------------------------------------------
// stack_deploy / stack_rollback
// -----------------------------------------------------------------------------

export const stackDeployParamsSchema = projectParamsSchema.extend({
  stack: stackNameSchema,
  env: envNameSchema,
  revision: z
    .integer()
    .min(1)
    .optional()
    .describe(
      "The revision to apply; the newest uploaded when omitted. Ignored with `app`.",
    ),
  app: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe(
      "Deploy ONE app service instead of the stack: the member app instance named so, in this environment, gets the build `tag` alone, blue/green, and no compose change is applied.",
    ),
  tag: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe("With `app`: the stored build to ship; `latest` when omitted."),
});

export const stackDeployResultSchema = z.object({
  id: z.string().describe("The deploy's id."),
  status: z.string(),
  kind: z.enum(["stack", "app"]),
});

export const stackRollbackParamsSchema = projectParamsSchema.extend({
  stack: stackNameSchema,
  env: envNameSchema,
  revision: z
    .integer()
    .min(1)
    .describe(
      "The earlier revision to deploy again. Volumes and their data are untouched.",
    ),
});

// -----------------------------------------------------------------------------
// stack_logs
// -----------------------------------------------------------------------------

export const stackLogsParamsSchema = projectParamsSchema.extend({
  stack: stackNameSchema,
  env: envNameSchema,
  service: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "The service to read. Asks the machine and answers a `request` to read back; omit it when passing `request`.",
    ),
  lines: z.integer().min(1).max(2000).optional(),
  request: z
    .uuid()
    .optional()
    .describe(
      "A request id an earlier call answered: reads its lines once the machine has uploaded them.",
    ),
});

export const stackLogsResultSchema = z.object({
  request: z.string(),
  status: z
    .string()
    .describe(
      "`pending`/`sent`/`running` while the machine works; `done` with lines; `failed` with a reason.",
    ),
  reason: z.string().optional(),
  lines: z.array(z.string()).optional(),
});
