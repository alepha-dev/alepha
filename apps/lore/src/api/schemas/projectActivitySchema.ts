import { type Infer, z } from "alepha";

/**
 * One thing that happened in a project, as the activity feed reports it.
 *
 * Deliberately flat and small: the point is a cheap diff since a timestamp,
 * so a caller can decide what to re-read. Bodies live behind `quest_get`,
 * `feedback_get` and `folio_get`.
 */
export const projectActivityEventSchema = z.object({
  at: z.datetime(),
  kind: z.enum([
    "quest.created",
    "quest.updated",
    "quest.accepted",
    "quest.unassigned",
    "quest.completed",
    "quest.shelved",
    "quest.commented",
    "feedback.created",
    "folio.updated",
    "epic.created",
    "epic.updated",
    "release.created",
    "release.published",
  ]),
  /**
   * Who did it, as an account id. Absent when the row carries no actor: a
   * plain field edit derived from `updatedAt`, or an author whose account
   * has been deleted.
   */
  actorId: z.uuid().optional(),
  /**
   * The account's display name, resolved by the controller. Same value the
   * quest page shows, so a name reads identically in both places.
   */
  actor: z.string().optional(),
  /**
   * `agent` when a machine wrote it. Only comments carry provenance today
   * (`quest_comments.source`), so it is absent on everything else, which
   * means "unknown", not "human".
   */
  actorKind: z.enum(["human", "agent"]).optional(),
  quest: z.object({ shortId: z.integer(), title: z.string() }).optional(),
  feedback: z.object({ shortId: z.integer(), title: z.string() }).optional(),
  folio: z.object({ shortId: z.integer(), title: z.string() }).optional(),
  /**
   * `number`, not `shortId`: an epic's per-project identifier is its
   * `number`, and it is what the URL segment and MCP both name it by.
   */
  epic: z.object({ number: z.integer(), title: z.string() }).optional(),
  /**
   * A release is addressed by its TAG, so that is what a consumer needs to
   * build a link. `tag` is nullable at the column (declaring it `NOT NULL`
   * would force a column DEFAULT, see `releases.ts`) even though the create
   * schema requires it, so it stays optional here rather than being coerced
   * into something that does not resolve.
   */
  release: z
    .object({ tag: z.string().optional(), title: z.string() })
    .optional(),
  /**
   * One short phrase, already readable without decoding `kind`.
   */
  summary: z.string(),
});

export type ProjectActivityEvent = Infer<typeof projectActivityEventSchema>;

export const projectActivityResultSchema = z.object({
  events: z.array(projectActivityEventSchema),
  /**
   * True when more events matched than `limit` allowed. Call again with
   * `since` set to `until`.
   */
  truncated: z.boolean(),
  /**
   * The window actually used. Differs from what was asked when
   * `sinceClamped` is true.
   */
  since: z.datetime(),
  /**
   * True when the requested `since` reached further back than the feed
   * serves and was pulled forward.
   */
  sinceClamped: z.boolean(),
  /**
   * The stamp of the last event returned, to pass back as the next call's
   * `since`. Equals `since` when nothing matched, so a cursor never moves
   * backwards over events it has not seen.
   */
  until: z.datetime(),
});

export type ProjectActivityResult = Infer<typeof projectActivityResultSchema>;
