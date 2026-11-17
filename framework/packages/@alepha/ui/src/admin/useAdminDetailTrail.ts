import { useHead } from "alepha/react/head";
import { useI18n } from "alepha/react/i18n";
import { useEffect } from "react";

import { useNavCrumbs } from "../shell/useNavCrumbs.ts";

/**
 * A detail page's place in the admin: `Admin > Jobs > uptime.tick` in the
 * breadcrumb, where `Jobs` links back to the list, and the same trail in
 * the tab title (`Admin - Jobs - uptime.tick`).
 *
 * `record` is what the page is about (a job's name, an endpoint, a person).
 * `undefined` while it loads leaves the route's own crumb and title.
 */
export const useAdminDetailTrail = (
  route: string,
  list: { label: string; href: string },
  record: string | undefined,
): void => {
  const { tr } = useI18n();
  const [, setHead] = useHead();

  useNavCrumbs(
    route,
    record
      ? [{ label: list.label, href: list.href }, { label: record }]
      : undefined,
  );

  const title = record
    ? tr("admin.title", {
        default: "Admin - $1",
        args: [`${list.label} - ${record}`],
      })
    : undefined;
  useEffect(() => {
    if (title) setHead({ title });
  }, [title, setHead]);
};
