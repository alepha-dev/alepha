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
    source="@alepha/ui/components/admin/admin-sessions"
    description="Active sessions with their owner, origin, device and last sign of life. Revoking is accepted and discarded here."
  >
    <Specimen
      title="AdminSessions"
      description="The row carries no refresh token, and that is the real projection rather than a showcase simplification: exposing one would hand over full impersonation."
    >
      <AdminSessions />
    </Specimen>
  </BlockPage>
);

export default Sessions;
