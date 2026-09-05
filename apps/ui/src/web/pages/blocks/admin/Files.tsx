import { AdminFiles } from "@alepha/ui/components/admin/admin-files";

import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";

/**
 * The bucket filter is built from the storage stats, not from the rows, so the
 * fixture derives its stats from its own rows. Writing both by hand would let
 * the filter offer a bucket nothing belongs to, which reads as a broken filter.
 */
const Files = () => (
  <BlockPage
    title="Admin: files"
    source="@alepha/ui/components/admin/admin-files"
    description="Stored files across buckets, with size, type and uploader. Uploading is accepted and stores nothing; deleting is accepted and removes nothing."
  >
    <Specimen
      title="AdminFiles"
      description="Two clients feed this: the file controller lists and mutates, the stats controller populates the bucket filter."
    >
      <AdminFiles />
    </Specimen>
  </BlockPage>
);

export default Files;
