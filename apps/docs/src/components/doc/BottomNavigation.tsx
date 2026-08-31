import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useActive, useRouter } from "alepha/react/router";
import { useMemo } from "react";

import { type DocProduct, docsHref, docsOf } from "../../config/docs.ts";

interface BottomNavigationProps {
  product: DocProduct;
  name: string;
}

/**
 * ⚠️ Scoped to one doc set. The flat `docs` list holds all three now, in root
 * order, so walking it would step off the end of the framework guides and
 * into the Bay introduction - and a name is not unique across products
 * either, so even finding the current page needs the narrowing first (quest
 * #1603).
 */
const BottomNavigation = (props: BottomNavigationProps) => {
  const nav = useMemo(() => {
    const pages = docsOf(props.product);
    const index = pages.findIndex((it) => it.name === props.name);

    return {
      next: pages[index + 1]
        ? {
            path: docsHref(pages[index + 1]),
            name: pages[index + 1].name,
          }
        : undefined,
      previous: pages[index - 1]
        ? {
            path: docsHref(pages[index - 1]),
            name: pages[index - 1].name,
          }
        : undefined,
    };
  }, [props.product, props.name]);

  return (
    <nav
      className="bottom-nav mt-6 pt-6 pb-6"
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
      onClick={() => router.push(href)}
      aria-label={label}
      aria-busy={isPending}
      disabled={isPending}
      className="btn-reset nav-button flex w-full cursor-pointer items-center gap-3"
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
        <span className="text-muted text-xs" aria-hidden="true">
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
