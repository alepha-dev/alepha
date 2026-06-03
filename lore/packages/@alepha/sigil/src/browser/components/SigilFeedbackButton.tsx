/**
 * Props for the SigilFeedbackButton component.
 */
export type SigilFeedbackButtonProps = {};

/**
 * Floating feedback button.
 *
 * On click it synchronously opens the same-origin `/sigil/request`
 * endpoint in a popup. That endpoint resolves the sigil → campaign id
 * server-side and 302-redirects to the first-party Lore petition page, so
 * the sigil id never reaches the browser. Styled entirely inline — no
 * stylesheet dependency.
 */
export const SigilFeedbackButton = (_props: SigilFeedbackButtonProps) => {
  const openPetition = () => {
    const popup = window.open(
      "/sigil/request",
      "lore-petition",
      "width=480,height=720",
    );
    if (!popup) window.open("/sigil/request", "_blank");
  };

  return (
    <button
      type="button"
      aria-label="Feedback"
      onClick={openPetition}
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 2147483000,
        width: 44,
        height: 44,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#4f46e5",
        color: "#fff",
        border: 0,
        borderRadius: 9999,
        cursor: "pointer",
        boxShadow: "0 4px 12px rgba(0,0,0,.25)",
      }}
    >
      {/* lucide MessageSquareWarning — chat bubble with a "!" */}
      <svg
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
        <line x1="12" x2="12" y1="8" y2="12" />
        <line x1="12" x2="12.01" y1="16" y2="16" />
      </svg>
    </button>
  );
};
