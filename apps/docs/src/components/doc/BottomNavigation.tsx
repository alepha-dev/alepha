import { useActive, useRouter } from "@alepha/react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useMemo } from "react";
import { docs } from "../../config/docs.ts";

interface BottomNavigationProps {
  name: string;
}

const BottomNavigation = (props: BottomNavigationProps) => {
  const nav = useMemo(() => {
    const index = docs.findIndex((it) => it.name === props.name);

    return {
      next: docs[index + 1]
        ? {
            path: `/docs/${docs[index + 1].slug}`,
            name: docs[index + 1].name,
          }
        : undefined,
      previous: docs[index - 1]
        ? {
            path: `/docs/${docs[index - 1].slug}`,
            name: docs[index - 1].name,
          }
        : undefined,
    };
  }, [props.name]);

  return (
    <div
      className="mt-6 pt-6 pb-6 bottom-nav"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 16,
      }}
    >
      <div>
        {nav.previous && (
          <NavButton
            direction="prev"
            name={nav.previous.name}
            href={nav.previous.path}
          />
        )}
      </div>
      <div>
        {nav.next && (
          <NavButton
            direction="next"
            name={nav.next.name}
            href={nav.next.path}
          />
        )}
      </div>
    </div>
  );
};

export default BottomNavigation;

// =============================================================================
// NAV BUTTON
// =============================================================================

interface NavButtonProps {
  direction: "prev" | "next";
  href: string;
  name: string;
}

const NavButton = (props: NavButtonProps) => {
  const { href, name, direction } = props;
  const { isPending } = useActive(href);
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.go(href)}
      className="btn-reset nav-button flex items-center gap-3 cursor-pointer w-full"
      style={{
        padding: "12px 16px",
        background: "transparent",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        color: "var(--color-text)",
        justifyContent: direction === "next" ? "flex-end" : "flex-start",
        opacity: isPending ? 0.5 : 1,
        transition: "all 0.15s ease",
      }}
    >
      {direction === "prev" && (
        <IconChevronLeft
          size={16}
          className="nav-arrow nav-arrow-prev"
          style={{ color: "var(--color-text-muted)" }}
        />
      )}
      <div
        className="flex flex-col"
        style={{
          alignItems: direction === "next" ? "flex-end" : "flex-start",
        }}
      >
        <span className="text-xs text-muted">
          {direction === "prev" ? "Previous" : "Next"}
        </span>
        <span className="text-sm" style={{ color: "var(--color-text-bright)" }}>
          {name}.md
        </span>
      </div>
      {direction === "next" && (
        <IconChevronRight
          size={16}
          className="nav-arrow nav-arrow-next"
          style={{ color: "var(--color-text-muted)" }}
        />
      )}
    </button>
  );
};
