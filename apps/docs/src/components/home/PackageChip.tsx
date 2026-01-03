import { Link } from "@alepha/react/router";
import { type CSSProperties, useCallback, useRef, useState } from "react";
import type { coreFeatures } from "../../config/features.ts";
import styles from "./PackageChip.module.css";

interface PackageChipProps {
  feature: (typeof coreFeatures)[number];
  index: number;
  isActive?: boolean;
  isReverse?: boolean;
}

const PackageChip = ({
  feature,
  index,
  isActive,
  isReverse,
}: PackageChipProps) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    timeoutRef.current = setTimeout(() => setShowTooltip(true), 400);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setShowTooltip(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  return (
    <Link
      href={`/docs/${feature.slug}`}
      className={styles.link}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className={`${styles.chip} ${isActive ? styles.snakeBorder : ""}`}
        style={{ "--animation-delay": `${index * 0.02}s` } as CSSProperties}
      >
        <feature.icon size={16} className={styles.icon} />
        <span>{feature.title}</span>

        {"new" in feature && feature.new && (
          <span className={styles.badge}>NEW</span>
        )}

        {isActive && (
          <svg
            className={styles.snakeBorderSvg}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <rect
              className={`${styles.snakeBorderRect} ${isReverse ? styles.snakeBorderReverse : ""}`}
              x="1"
              y="1"
              width="98"
              height="98"
              rx="2"
              ry="2"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}

        {showTooltip && (
          <div className={styles.tooltip}>
            <span className={styles.tooltipText}>{feature.description}</span>
            {feature.module && (
              <span className={styles.tooltipModule}>{feature.module}</span>
            )}
            <div className={styles.tooltipArrow} />
          </div>
        )}
      </div>
    </Link>
  );
};

export default PackageChip;
