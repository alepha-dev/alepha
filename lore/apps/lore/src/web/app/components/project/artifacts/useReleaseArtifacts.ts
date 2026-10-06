import type { ResourceTabSubject } from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";

import type { ArtifactController } from "@/api/controllers/ArtifactController.ts";
import type { ArtifactGroup } from "@/api/schemas/artifactGroupSchema.ts";

/**
 * The artifacts built from a release's tag: what the release page's
 * Artifacts tab lists, and what its plate, KPI and retag warning count
 * (registered by `DeployShell` on core's `ResourceTabRegistry`, #E75,
 * #Q2624).
 *
 * ⚠️ Keyed on the TAG, which is the join: `artifacts.tag = releases.tag`,
 * with no join table and no foreign key. Retagging a release therefore
 * changes what this returns, which is exactly what the edit sheet warns
 * about.
 *
 * A release with no tag asks for nothing: the query would be unanswerable,
 * and `enabled: false` is the honest way to say so rather than a request for
 * the empty string.
 */
export const useReleaseArtifacts = (
  subject: ResourceTabSubject,
): { artifacts: ArtifactGroup[]; count?: number; loading: boolean } => {
  const artifactApi = useClient<ArtifactController>();
  const { data, loading } = useQuery(
    {
      enabled: Boolean(subject.projectId && subject.tag),
      key: ["release-artifacts", subject.projectId, subject.tag],
      handler: async () => {
        if (!subject.tag) return undefined;
        return await artifactApi.listArtifacts({
          params: { projectId: subject.projectId },
          query: { tag: subject.tag },
        });
      },
    },
    [subject.projectId, subject.tag],
  );

  const artifacts = data?.groups ?? [];
  return {
    artifacts,
    // Variants, not groups: the Artifacts tab lists one row per variant
    // since #Q2267, so the count on its badge, on the plate and in the
    // retag warning is the number of rows a reader sees there.
    count: artifacts.reduce((count, group) => count + group.variants.length, 0),
    loading,
  };
};
