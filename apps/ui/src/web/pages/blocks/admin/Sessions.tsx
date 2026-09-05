import { AdminSessions } from "@alepha/ui/components/admin/admin-sessions";

import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";

/**
 * The fixtures cover all four device kinds and include one already-expired
 * session, because both the device column and the status column render a
 * different thing per value and a uniform dataset would leave most of them
 * unseen.
 */
const Sessions = () => (
  <BlockPage
    title="Admin: sessions"
    description="Active sessions, and how to end them."
  >
    <Specimen title="AdminSessions">
      <AdminSessions />
    </Specimen>
  </BlockPage>
);

export default Sessions;
