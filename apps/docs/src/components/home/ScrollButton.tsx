import { IconChevronDown } from "@tabler/icons-react";
import { useCallback } from "react";

interface ScrollButtonProps {
  targetId: string;
  label?: string;
}

const ScrollButton = ({ targetId, label }: ScrollButtonProps) => {
  const handleScroll = useCallback(() => {
    const target = document.getElementById(targetId);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [targetId]);

  return (
    <button
      type="button"
      onClick={handleScroll}
      className="scroll-down-btn"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: "16px 24px",
        marginTop: "clamp(24px, 6vw, 48px)",
        color: "var(--color-text-muted)",
        transition: "all 0.2s ease",
      }}
    >
      {label && (
        <span
          style={{
            fontSize: 12,
            fontFamily: "monospace",
            letterSpacing: "0.5px",
          }}
        >
          {label}
        </span>
      )}
      <IconChevronDown
        size={28}
        style={{
          animation: "bounceDown 2s ease-in-out infinite",
        }}
      />
    </button>
  );
};

export default ScrollButton;
