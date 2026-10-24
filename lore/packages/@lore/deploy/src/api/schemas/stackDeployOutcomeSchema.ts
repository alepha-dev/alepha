import type { Infer } from "alepha";
import { z } from "alepha";

/**
 * What a machine uploads when it has applied a stack revision: Bay's
 * `stackDeployOutcome`, pinned by its `outcome-stack-deploy.json` fixture.
 * Bounded everywhere: the machine is not trusted with a size.
 */
export const stackDeployOutcomeSchema = z.object({
  stack: z.string().max(100),
  env: z.string().max(100),
  revision: z.integer().min(0),
  plan: z.object({
    created: z.array(z.string().max(100)).max(200).nullable().optional(),
    changed: z.array(z.string().max(100)).max(200).nullable().optional(),
    removed: z.array(z.string().max(100)).max(200).nullable().optional(),
    fields: z
      .record(z.string().max(100), z.array(z.string().max(100)).max(50))
      .optional(),
  }),
  members: z
    .array(
      z.object({
        service: z.string().max(100),
        kind: z.string().max(20),
        domains: z.array(z.string().max(253)).max(50).optional(),
        port: z.integer().optional(),
      }),
    )
    .max(200)
    .nullable()
    .optional(),
  pending: z.array(z.string().max(100)).max(200).nullable().optional(),
  warnings: z.array(z.string().max(500)).max(100).nullable().optional(),
  digests: z.record(z.string().max(100), z.string().max(600)).optional(),
});

export type StackDeployOutcome = Infer<typeof stackDeployOutcomeSchema>;
