import { useState } from "react";
import { SigilDialog } from "./SigilDialog.tsx";
import { SigilFeedbackButton } from "./SigilFeedbackButton.tsx";

/**
 * Root Sigil component.
 *
 * Composes the floating feedback button and the petition dialog. Drop this
 * anywhere in the React tree (e.g., in your app shell) to enable in-app
 * feedback for your users.
 *
 * Reporter email is intentionally omitted in v1. Wiring it requires a
 * generic Alepha hook to read the current user's email without hard-coupling
 * to any specific auth module. Add `reporterEmail={currentUser?.email}` to
 * `<SigilDialog>` once such a hook exists (e.g., `useCurrentUser()`).
 */
export const SigilRoot = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <SigilFeedbackButton onClick={() => setOpen(true)} />
      {open && <SigilDialog onClose={() => setOpen(false)} />}
    </>
  );
};
