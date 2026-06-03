import { SigilFeedbackButton } from "./SigilFeedbackButton.tsx";

/**
 * Root Sigil component.
 *
 * Renders the floating feedback button. Drop this anywhere in the React
 * tree (e.g., in your app shell) to enable in-app feedback for your users.
 * The button opens the first-party Lore petition page in a popup via the
 * same-origin `/api/sigil/request` proxy.
 */
export const SigilRoot = () => {
  return <SigilFeedbackButton />;
};
