import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";

/**
 * Which releases a row may be moved to, and whether it may be moved at all.
 *
 * The rules are `EpicReleaseControl`'s and `QuestReleaseControl`'s, read out
 * of one place so a row menu cannot drift from the control on the detail
 * page. Both surfaces write the same field through the same endpoint, and a
 * second copy of the filter is how one of them ends up offering a release
 * the other refuses.
 *
 * - **Only OPEN releases are offered.** A published release's contents are
 *   its record and its counts are frozen, so attaching to one would make the
 *   row disagree with itself. `ReleaseAttachmentService` refuses it too - the
 *   menu is the affordance, not the guard.
 * - **The row's CURRENT release stays offered even once published**, so the
 *   menu can show what it is rather than reading as though the attachment
 *   were lost. `locked` is what stops it being pickable: the control
 *   disables its trigger in exactly this case.
 * - **No options at all means no menu.** A project with no open release and a
 *   row attached to nothing has nothing to offer, and an entry that could
 *   only ever say "No release" to a row that already has none is noise. An
 *   empty `children` array renders nothing and does not create the row's
 *   three-dots trigger by itself, so the caller needs no special case.
 */
export const releaseRowMenu = (
  releases: ReleaseResource[] | undefined,
  releaseId: number | null | undefined,
): { options: ReleaseResource[]; locked: boolean } => {
  const all = releases ?? [];
  const current = all.find((release) => release.id === releaseId);
  return {
    options: all.filter(
      (release) => !release.releasedAt || release.id === releaseId,
    ),
    locked: !!current?.releasedAt,
  };
};
