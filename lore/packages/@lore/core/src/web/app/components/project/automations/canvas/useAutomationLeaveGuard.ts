import { useDialog } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useEffect, useRef } from "react";

import type { I18n } from "../../../../services/I18n.ts";

/**
 * Asks before an unsaved draft is left (#Q3811). The router has no
 * navigation blocker, so a click on an in-app link is caught on its way
 * down, confirmed, and pushed again once confirmed; a reload or a closed
 * tab gets the browser's own question.
 */
export const useAutomationLeaveGuard = (dirty: boolean) => {
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  // The guard pushes a path, never a page name.
  const router = useRouter<any>();
  const latest = useRef({ dirty, tr, dialog, router });
  latest.current = { dirty, tr, dialog, router };
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onClick = (event: MouseEvent) => {
      const current = latest.current;
      if (
        !current.dirty ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank")
        return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      void current.dialog
        .confirm({
          title: current.tr("automation.canvas.leave.title"),
          description: current.tr("automation.canvas.leave.description"),
          confirmLabel: current.tr("automation.canvas.leave.confirm"),
          destructive: true,
        })
        .then((leave) => {
          if (leave)
            void latest.current.router.push(
              `${url.pathname}${url.search}${url.hash}`,
            );
        });
    };
    const onUnload = (event: BeforeUnloadEvent) => {
      if (!latest.current.dirty) return;
      event.preventDefault();
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);
};
