import { type Infer, z } from "alepha";

/**
 * What a machine is told to do, when there is anything to tell it.
 *
 * Answered on the command channel — the short outbound poll a Bay runs
 * alongside its minute-long report. The two are separate because they answer
 * different questions: the report carries the state of the world and can
 * afford to be slow and fat, this one is what stands between `platform up`
 * finishing and a human waiting, and is empty in the overwhelming majority of
 * cases.
 *
 * There is exactly one command today. It stays a named field rather than a
 * bare payload so a second one — restart, rollback — is an added key rather
 * than a wire break.
 */
export const outpostCommands = z.object({
  deploy: z
    .object({
      releaseId: z.uuid(),
      app: z.string(),
      environment: z.string(),
      version: z.string(),
      /**
       * The digest the machine must verify what it downloads against.
       *
       * Sent rather than assumed: it is what lets an outpost skip an artifact
       * it already holds, and refuse one that arrives corrupted or swapped.
       */
      sha256: z.string(),
      /**
       * Where to fetch the artifact, absolute.
       *
       * On this same credential — the machine already presents its `op_` here,
       * and adding a signed-URL scheme would mean a second way in for bytes
       * that are, by construction, only ever wanted by the machine that just
       * claimed them.
       */
      downloadUrl: z.string(),
      sizeBytes: z.integer().optional(),
    })
    .optional(),
});

export type OutpostCommands = Infer<typeof outpostCommands>;
