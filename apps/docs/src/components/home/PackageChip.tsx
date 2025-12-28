import { Link } from "@alepha/react";
import { useCallback, useRef, useState } from "react";
import type { coreFeatures } from "../../config/features.ts";

interface PackageChipProps {
  feature: (typeof coreFeatures)[number];
  index: number;
}

const PackageChip = ({ feature, index }: PackageChipProps) => {
  const [hovered, setHovered] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    setHovered(true);
    timeoutRef.current = setTimeout(() => setShowTooltip(true), 400);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHovered(false);
    setShowTooltip(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  return (
    <Link
      href={`/docs/${feature.slug}`}
      style={{ textDecoration: "none" }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className="animate-slide-up package-chip"
        style={{
          animationDelay: `${index * 0.02}s`,
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 16px",
          fontFamily: "monospace",
          fontSize: 13,
          background: "var(--color-bg)",
          border: `1px solid ${hovered ? "var(--color-border-focus)" : "var(--color-border)"}`,
          borderRadius: 6,
          color: hovered ? "var(--color-text-bright)" : "var(--color-text)",
          cursor: "pointer",
          transition: "all 0.15s ease",
          transform: hovered ? "translateY(-1px)" : "translateY(0)",
        }}
      >
        <feature.icon
          size={16}
          style={{
            color: "var(--color-cyan)",
            flexShrink: 0,
          }}
        />
        <span>{feature.title}</span>
        {"new" in feature && feature.new && (
          <span
            style={{
              fontSize: 8,
              fontWeight: 700,
              color: "var(--color-bg)",
              background: "var(--color-accent)",
              padding: "2px 4px",
              borderRadius: 3,
              marginLeft: 2,
            }}
          >
            NEW
          </span>
        )}

        {/* Tooltip */}
        {showTooltip && (
          <div
            style={{
              position: "absolute",
              bottom: "calc(100% + 8px)",
              left: "50%",
              transform: "translateX(-50%)",
              padding: "10px 14px",
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: 6,
              fontSize: 12,
              fontFamily: "inherit",
              whiteSpace: "nowrap",
              zIndex: 100,
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.3)",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <span style={{ color: "var(--color-text)" }}>
              {feature.description}
            </span>
            {feature.module && (
              <span
                style={{
                  color: "var(--color-text-muted)",
                  fontSize: 10,
                  fontFamily: "monospace",
                }}
              >
                {feature.module}
              </span>
            )}
            <div
              style={{
                position: "absolute",
                bottom: -5,
                left: "50%",
                transform: "translateX(-50%) rotate(45deg)",
                width: 8,
                height: 8,
                background: "var(--color-bg-elevated)",
                borderRight: "1px solid var(--color-border)",
                borderBottom: "1px solid var(--color-border)",
              }}
            />
          </div>
        )}
      </div>
    </Link>
  );
};

export default PackageChip;
