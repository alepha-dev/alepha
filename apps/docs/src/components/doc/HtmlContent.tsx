import { useEffect, useMemo, useRef } from "react";

interface HtmlContentProps {
  html: string;
}

const PACKAGE_MANAGERS = ["npm", "yarn", "pnpm", "bun"] as const;
type PackageManager = (typeof PACKAGE_MANAGERS)[number];
const STORAGE_KEY = "alepha-pm";

/**
 * Syncs all package manager code blocks to the selected package manager.
 * Updates the active tab, code content, and copy button data.
 */
const syncPackageManager = (
  container: HTMLElement,
  pm: PackageManager,
): void => {
  container.querySelectorAll(".code-block-pm").forEach((block) => {
    // Update active tab
    block.querySelectorAll<HTMLButtonElement>(".pm-tab").forEach((tab) => {
      tab.classList.toggle("pm-tab-active", tab.dataset.pm === pm);
    });

    // Update code content
    const code = block.querySelector("code");
    const htmlAttr = `data-html-${pm}`;
    if (code?.hasAttribute(htmlAttr)) {
      code.innerHTML = code.getAttribute(htmlAttr) || "";
    }

    // Update copy button data attribute
    const copyBtn = block.querySelector<HTMLButtonElement>(".code-block-copy");
    const codeAttr = `data-code-${pm}`;
    if (copyBtn?.hasAttribute(codeAttr)) {
      copyBtn.setAttribute("data-code", copyBtn.getAttribute(codeAttr) || "");
    }
  });
};

const HtmlContent = (props: HtmlContentProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => {
    const onclick = (url: string) => {
      return `event.preventDefault();go('${url}')`;
    };
    return props.html.replace(/<a href="\/docs\/(.*)">/gim, (_, arg1) => {
      const pathname = `${import.meta.env.BASE_URL ?? "/"}docs/${arg1}`;
      return `<a href="${pathname}" onclick="${onclick(`/docs/${arg1}`)}">`;
    });
  }, [props.html]);

  // Set up package manager sync after content is rendered
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Check if there are any PM blocks
    const pmBlocks = container.querySelectorAll(".code-block-pm");
    if (pmBlocks.length === 0) return;

    // Restore saved preference
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && PACKAGE_MANAGERS.includes(saved as PackageManager)) {
      syncPackageManager(container, saved as PackageManager);
    }

    // Handle tab clicks - delegate from container
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.classList.contains("pm-tab")) return;

      const pm = target.dataset.pm as PackageManager;
      if (!pm || !PACKAGE_MANAGERS.includes(pm)) return;

      // Save preference
      localStorage.setItem(STORAGE_KEY, pm);

      // Sync all blocks on the page (including outside this container)
      document.querySelectorAll("#html-content").forEach((content) => {
        syncPackageManager(content as HTMLElement, pm);
      });
    };

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [html]);

  return (
    <div
      ref={containerRef}
      id="html-content"
      className="terminal-content"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML content is sanitized at build time
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default HtmlContent;
