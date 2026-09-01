import { type Infer, z } from "alepha";

import { releaseResourceSchema } from "./releaseResourceSchema.ts";
import { roadmapEpicSchema } from "./roadmapEpicSchema.ts";

/**
 * A release as the roadmap publishes it: what it is called, when it is meant
 * to land, how far along it is, and which epics are in it.
 *
 * Picked off {@link releaseResourceSchema} rather than restated. `id`,
 * `projectId`, `number`, `createdAt`, `updatedAt`, `changelog` and
 * `changelogGroups` are all absent, and stay absent by construction: `pick`
 * makes exclusion the default, so a column added to `releases` never rides
 * along into a public response.
 *
 * `number` in particular is left out on purpose even though it is harmless -
 * the ORDER of this array is the server's answer, and shipping the sort key
 * would invite a client to re-sort by it. Creation order and version order
 * disagree the moment a release is planned ahead of one that ships sooner.
 *
 * ⚠️ `progress` follows the RELEASE convention, where `shelved` sits OUTSIDE
 * `total` - not the epic one, where it sits inside. Both are deliberate; see
 * `releases.total` for the release half and `epicResourceSchema` for the
 * epic half.
 */
export const roadmapReleaseSchema = releaseResourceSchema
  .pick({
    tag: true,
    title: true,
    description: true,
    targetDate: true,
    releasedAt: true,
    progress: true,
  })
  .extend({
    /**
     * The epics attached to this release, in `number` order.
     *
     * ⚠️ **Empty for a released release, on purpose.** A published release
     * renders entirely from the four counts frozen onto its own row and is
     * never recomputed, so listing epics whose progress IS recomputed would
     * put a live number beside a frozen one in the same card. What a released
     * release contains is its frozen changelog, which is a member surface.
     */
    epics: z.array(roadmapEpicSchema),
  });

export type RoadmapRelease = Infer<typeof roadmapReleaseSchema>;
