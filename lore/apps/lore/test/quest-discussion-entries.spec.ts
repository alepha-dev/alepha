import { describe, it } from "vitest";

import type { QuestCommentResource } from "../src/api/schemas/questCommentResourceSchema.ts";
import type { QuestResource } from "../src/api/schemas/questResourceSchema.ts";
import { buildQuestDiscussionEntries } from "../src/web/app/components/project/quest/questDiscussionEntries.ts";

/**
 * The Discussion is one feed, not two lists, so the interleaving is the
 * feature. This is the pure half of it — what belongs in the list, whose it
 * is, and in what order — kept out of the components so it can be asserted
 * without a DOM.
 */

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

const quest = (over: Partial<QuestResource> = {}): QuestResource =>
  ({
    id: 1,
    shortId: 1,
    title: "Probe",
    description: "",
    area: "core",
    priority: "medium",
    createdAt: "2026-08-01T10:00:00.000Z",
    createdBy: ALICE,
    updatedAt: "2026-08-01T10:00:00.000Z",
    objectives: [],
    history: [],
    attachments: [],
    tags: [],
    timerSessions: [],
    note: "",
    projectId: 1,
    metadata: {
      status: "new",
      objectivesProgress: { completed: 0, total: 0 },
      totalTimeSpent: 0,
    },
    ...over,
  }) as QuestResource;

const comment = (
  id: number,
  at: string,
  authorId?: string,
): QuestCommentResource =>
  ({
    id,
    questId: 1,
    authorId,
    body: `comment ${id}`,
    createdAt: at,
    updatedAt: at,
  }) as QuestCommentResource;

describe("buildQuestDiscussionEntries", () => {
  it("always opens with the creation, attributed to the creator", ({
    expect,
  }) => {
    const entries = buildQuestDiscussionEntries(quest(), []);

    // The old timeline hardcoded "by You" here regardless of who created it.
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "event",
      action: "created",
      by: ALICE,
    });
  });

  it("names the feedback item a promoted quest came from", ({ expect }) => {
    const entries = buildQuestDiscussionEntries(quest({ feedbackId: 62 }), []);

    expect(entries[0]).toMatchObject({ action: "created", feedbackId: 62 });
  });

  it("interleaves comments and events by timestamp, oldest first", ({
    expect,
  }) => {
    const entries = buildQuestDiscussionEntries(
      quest({
        history: [
          { at: "2026-08-01T12:00:00.000Z", by: BOB, action: "assigned" },
        ],
        completedAt: "2026-08-01T16:00:00.000Z",
        completedBy: BOB,
      } as Partial<QuestResource>),
      [
        comment(1, "2026-08-01T11:00:00.000Z", ALICE),
        comment(2, "2026-08-01T14:00:00.000Z", BOB),
      ],
    );

    expect(entries.map((e) => e.key)).toEqual([
      "created",
      "comment-1",
      "history-0",
      "comment-2",
      "completed",
    ]);
  });

  it("derives completion from the quest's own columns, with its own actor", ({
    expect,
  }) => {
    const entries = buildQuestDiscussionEntries(
      quest({
        completedAt: "2026-08-02T09:00:00.000Z",
        completedBy: BOB,
      }),
      [],
    );

    expect(entries.at(-1)).toMatchObject({ action: "completed", by: BOB });
  });

  it("resolves a completed objective to its title", ({ expect }) => {
    const entries = buildQuestDiscussionEntries(
      quest({
        objectives: [{ id: 7, title: "Ship the rail", completed: true }],
        history: [
          {
            at: "2026-08-01T12:00:00.000Z",
            by: ALICE,
            action: "objective_completed",
            objectiveId: 7,
          },
        ],
      } as Partial<QuestResource>),
      [],
    );

    expect(entries[1]).toMatchObject({
      action: "objective_completed",
      subject: "Ship the rail",
    });
  });

  it("leaves a comment from a deleted account without an author", ({
    expect,
  }) => {
    // `authorId` is set-null rather than cascade, so the comment survives the
    // account. The feed renders a tombstone for it.
    const entries = buildQuestDiscussionEntries(quest(), [
      comment(1, "2026-08-01T11:00:00.000Z", undefined),
    ]);

    expect(entries[1]).toMatchObject({ kind: "comment", by: undefined });
  });
});
