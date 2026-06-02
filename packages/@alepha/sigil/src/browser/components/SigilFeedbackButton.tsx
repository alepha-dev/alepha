/**
 * Props for the SigilFeedbackButton component.
 */
export interface SigilFeedbackButtonProps {
  /** Called when the button is clicked. */
  onClick: () => void;
}

/**
 * Floating action button that opens the Sigil feedback dialog.
 *
 * Renders a fixed-position FAB using the `.sigil-fab` class with
 * an inline MessageSquareWarning icon (Lucide-derived path).
 */
export const SigilFeedbackButton = (props: SigilFeedbackButtonProps) => {
  return (
    <button
      type="button"
      className="sigil-fab"
      aria-label="Feedback"
      onClick={props.onClick}
    >
      {/* MessageSquareWarning icon — Lucide-derived, inline SVG */}
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
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <path d="M12 7v4" />
        <path d="M12 15h.01" />
      </svg>
    </button>
  );
};
