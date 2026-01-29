import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useActive, useRouter } from "alepha/react/router";
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
    <nav
      className="mt-6 pt-6 pb-6 bottom-nav"
      aria-label="Document navigation"
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
    </nav>
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

  const label =
    direction === "prev"
      ? `Go to previous page: ${name}`
      : `Go to next page: ${name}`;

  return (
    <button
      type="button"
      onClick={() => router.go(href)}
      aria-label={label}
      aria-busy={isPending}
      disabled={isPending}
      className="btn-reset nav-button flex items-center gap-3 cursor-pointer w-full"
      style={{
        padding: "12px 16px",
        background: "transparent",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        color: isPending ? "var(--color-text-muted)" : "var(--color-text)",
        justifyContent: direction === "next" ? "flex-end" : "flex-start",
        cursor: isPending ? "wait" : "pointer",
        transition: "all 0.15s ease",
      }}
    >
      {direction === "prev" && (
        <IconChevronLeft
          size={16}
          className="nav-arrow nav-arrow-prev"
          style={{ color: "var(--color-text-muted)" }}
          aria-hidden="true"
        />
      )}
      <div
        className="flex flex-col"
        style={{
          alignItems: direction === "next" ? "flex-end" : "flex-start",
        }}
      >
        <span className="text-xs text-muted" aria-hidden="true">
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
          aria-hidden="true"
        />
      )}
    </button>
  );
};
