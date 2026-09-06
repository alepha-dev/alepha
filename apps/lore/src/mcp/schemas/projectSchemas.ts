import { z } from "alepha";

import { capabilityKeySchema } from "@/api/schemas/capabilityKeySchema.ts";

import { projectActivityRowSchema } from "../../api/schemas/projectActivityRowSchema.ts";
import { epicStatusSchema } from "./epicStatusSchema.ts";
import { prioritySchema } from "./prioritySchema.ts";
import { projectParamsSchema } from "./projectParamsSchema.ts";

// -----------------------------------------------------------------------------
// Shared sub-schemas
// -----------------------------------------------------------------------------

/**
 * Quest reference for orientation tools (project_info / project_context).
 * Carries enough for the agent to decide whether to drill down with
 * `quest_get`, but not the description body or objectives.
 */
const questOrientationRefSchema = z.object({
  id: z.integer(),
  shortId: z.integer(),
  title: z.string(),
  area: z.string(),
  priority: prioritySchema,
});

// -----------------------------------------------------------------------------
// project_list
// -----------------------------------------------------------------------------

export const projectListResultSchema = z.object({
  projects: z.array(
    z.object({
      id: z.integer(),
      title: z.string(),
      public: z.boolean(),
      isOwner: z.boolean(),
    }),
  ),
});

// -----------------------------------------------------------------------------
// project_info
// -----------------------------------------------------------------------------

export const projectInfoParamsSchema = projectParamsSchema;

export const projectInfoResultSchema = z.object({
  id: z.integer(),
  title: z.string(),
  public: z.boolean(),
  areas: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
    }),
  ),
  createdAt: z.datetime(),
  activeQuests: z.array(questOrientationRefSchema),
  /**
   * `true` when the calling user owns (created) this project.
   */
  isOwner: z.boolean(),
});

// -----------------------------------------------------------------------------
// project_context
//
// One-shot orientation tool: returns everything an AI agent needs to
// situate itself in a project without follow-up `folio_list` / `quest_get`
// round-trips. Bounded to ~2K tokens.
// -----------------------------------------------------------------------------

export const projectContextParamsSchema = projectParamsSchema;

/**
 * Folio entry in the orientation index.
 *
 * - `id` (uuid) is intentionally omitted to save tokens — agents reference
 *   folios by `shortId` + project for any follow-up call.
 * - `summary` is the agent-facing one-liner an author gave the folio;
 *   web-created folios may leave it empty.
 */
const folioIndexEntrySchema = z.object({
  shortId: z.integer(),
  title: z.string(),
  updatedAt: z.string(),
  summary: z.string().optional(),
  /**
   * The per-project number of the epic the folio is filed under, absent
   * when it has none. Just the number: the `epics` index in the same
   * payload carries the title and status, so repeating them here would
   * only cost tokens.
   */
  epicNumber: z.integer().optional(),
});

export const projectContextResultSchema = z.object({
  id: z.integer(),
  title: z.string(),
  public: z.boolean(),
  /**
   * What this project is: the capabilities it has turned on, and the options
   * inside each.
   *
   * ⚠️ **Read this before anything else, because it says which of the
   * sections below exist at all.** A section a disabled capability owns is
   * OMITTED rather than emptied, deliberately: `epics: []` on a project that
   * has no Work reads as "there are no epics yet", which is a different and
   * wrong answer. Absent means "this project does not do that".
   */
  capabilities: z.array(
    z.object({
      key: capabilityKeySchema,
      options: z.record(z.text(), z.boolean()),
    }),
  ),
  /**
   * The parts of the system a quest belongs to. **Work's**, so absent when
   * the project has no Work - a quest carries an area, and a blight forwards
   * into one.
   */
  areas: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
      }),
    )
    .optional(),
  createdAt: z.datetime(),
  /**
   * Quests the calling user has accepted and not yet completed. Matches the
   * `project_info` semantic — "what is the user currently working on" — so
   * agents pick up the same signal humans see in the project board.
   */
  activeQuests: z.array(questOrientationRefSchema).optional(),
  /**
   * The project's epic index — every epic, planned/active/done alike (this
   * is never gated, same as an epic's own view of itself). Kept to number,
   * title, status, questCount and completed deliberately: this is paid for
   * on every `project_context` call, and its whole job is to make a parked
   * subject legible in one round-trip, not to replace `epic_list` /
   * `epic_get`. Without it, a project with thirteen quests parked under one
   * epic shows up as thirteen unrelated quests, with no signal they are one
   * subject. `completed` joined the four in epic #31: without it "planned,
   * 9 specified" and "planned, 9 shipped" read the same, and epic #27 was
   * the second for a day before anyone noticed.
   */
  epics: z
    .array(
      z.object({
        number: z.integer(),
        title: z.string(),
        status: epicStatusSchema,
        questCount: z.integer(),
        completed: z
          .integer()
          .describe(
            "How many of questCount are completed. Equal to questCount on an epic whose work is done, whatever its status says.",
          ),
      }),
    )
    .optional(),
  /**
   * The releases still OPEN in this project, by number ascending.
   *
   * Published ones are omitted: this index exists so an agent opens a session
   * already knowing what `0.28.0` is meant to contain, and a shipped release
   * is not something to plan into. `release_list` returns all of them.
   *
   * Several open at once is the normal state, not a warning sign.
   */
  openReleases: z
    .array(
      z.object({
        tag: z.string().optional(),
        title: z.string(),
        targetDate: z.datetime().optional(),
        completed: z.integer(),
        total: z.integer(),
      }),
    )
    .optional(),
  /**
   * The calling user's folios in this project, newest-updated first. Bodies
   * are intentionally omitted — call `folio_get` only after deciding what's
   * relevant from this index.
   */
  folios: z
    .object({
      /**
       * Number of entries returned (≤ 30).
       */
      shown: z.integer(),
      /**
       * `true` if the index was capped at the limit — the agent should call
       * `folio_list` with a higher `limit` to see the rest.
       */
      capped: z.boolean(),
      items: z.array(folioIndexEntrySchema),
    })
    .optional(),
  /**
   * Full content of pinned folios — the project's CLAUDE.md / AGENTS.md
   * equivalent. Returned in `(pinned DESC, updatedAt DESC)` order; the
   * sum of `content` lengths is capped (see `pinnedFoliosTruncated`).
   * Protected (encrypted) folios are excluded since their content is
   * opaque ciphertext.
   */
  pinnedFolios: z
    .array(
      z.object({
        id: z.uuid(),
        shortId: z.integer(),
        title: z.string(),
        content: z.string(),
        /**
         * When set, the folio's content exceeded the per-call cap and was
         * truncated to this many characters. Renderers may show a
         * "truncated" badge so the agent knows to `folio_get` for the rest.
         */
        truncatedAt: z.integer().optional(),
      }),
    )
    .optional(),
  /**
   * `true` if the total pinned content exceeded the cap and at least one
   * pinned folio was dropped from the response. The agent can fall back
   * to `folio_get` on the dropped ones, or the user can unpin some.
   *
   * Absent with `pinnedFolios`, which belongs to Knowledge.
   */
  pinnedFoliosTruncated: z.boolean().optional(),
  /**
   * `true` when the calling user owns (created) this project.
   */
  isOwner: z.boolean(),
  /**
   * ISO 639-1 code (e.g. "fr", "ja") the owner picked as the preferred
   * language for AI-generated content. When set, agents should write
   * quest titles, descriptions and folio bodies in this language
   * unless the user explicitly asks for another. Absent = no
   * preference; fall back to the conversation language.
   */
  preferredLanguage: z.string().optional(),
});

// -----------------------------------------------------------------------------
// project_activity
// -----------------------------------------------------------------------------

export const projectActivityParamsSchema = projectParamsSchema.extend({
  since: z
    .datetime()
    .describe(
      "Return everything that happened strictly after this instant. Pass the `until` of your previous call, or the time your last session ended. There is no window limit any more: this reads an indexed event table rather than deriving events from six range scans, so a `since` of any age is answered directly. What bounds how far back you can see is retention, not the query.",
    ),
  limit: z
    .integer()
    .min(1)
    .max(200)
    .describe("Maximum events to return (default: 100).")
    .optional(),
  includeOwn: z
    .boolean()
    .describe(
      "Include events you performed yourself. Off by default: the question this answers is what OTHER people did, and your own writes are noise. Note that over MCP your account is the owner's, so your own comments and the owner's are indistinguishable here; `actorKind: \"agent\"` on a comment is the finer signal.",
    )
    .optional(),
});

/**
 * One recorded event, as `project_activity` reports it.
 *
 * Derived from the API row so the tool and the Activity page cannot describe
 * the same row differently, plus `summary`: a phrase already readable without
 * decoding `type` and `action` against each other.
 */
export const projectActivityEventSchema = projectActivityRowSchema
  .omit({ id: true, metadata: true, resourceType: true })
  .extend({
    summary: z
      .string()
      .describe(
        "One short phrase describing the event, e.g. `completed quest #208`.",
      ),
  });

export const projectActivityResultSchema = z.object({
  events: z
    .array(projectActivityEventSchema)
    .describe("Matching events, OLDEST first, so the last one is the newest."),
  truncated: z
    .boolean()
    .describe(
      "True when more events matched than `limit` allowed. Call again with `since` set to `until`.",
    ),
  since: z.datetime().describe("The lower bound actually used."),
  until: z
    .datetime()
    .describe(
      "The stamp of the last event read, to pass as the next call's `since`. Equals `since` when nothing matched, so the cursor never moves backwards over events you have not seen.",
    ),
});
