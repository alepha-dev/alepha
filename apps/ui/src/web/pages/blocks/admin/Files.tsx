import { AdminFiles } from "@alepha/ui/components/admin/admin-files";

import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";

/**
 * The bucket filter is built from the storage stats, not from the rows, so the
 * fixture derives its stats from its own rows. Writing both by hand would let
 * the filter offer a bucket nothing belongs to, which reads as a broken filter.
 */
const Files = () => (
  <BlockPage title="Admin: files" description="Stored files across buckets.">
    <Specimen title="AdminFiles">
      <AdminFiles />
    </Specimen>
  </BlockPage>
);

export default Files;
