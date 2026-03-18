import { ActionButton, Flex, Text, toTitleCase } from "@alepha/ui";
import type { FlexProps } from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";
import { useRouter, useRouterState } from "alepha/react/router";
import type { ReactNode } from "react";

export interface BreadcrumbProps extends FlexProps {
  /**
   * Label for the home/root crumb. Set to `false` to hide the root crumb.
   *
   * @default "Home"
   */
  home?: string | false;

  /**
   * Custom separator between crumbs.
   *
   * @default IconChevronRight
   */
  separator?: ReactNode;

  /**
   * Size of text and separator icons.
   *
   * @default "xs"
   */
  size?: string;
}

/**
 * Automatic breadcrumb component that reads the current route hierarchy
 * from the Alepha router's layer stack.
 *
 * Pages should define a `label` in their `$page()` options for best results.
 * Falls back to the page name converted to Title Case.
 */
const Breadcrumbs = (props: BreadcrumbProps) => {
  const { home = "Home", separator, size = "sm", ...groupProps } = props;

  const state = useRouterState();
  const router = useRouter();

  const crumbs: Array<{ label: string; href: string }> = [];

  // Optionally add home crumb
  if (home !== false) {
    crumbs.push({ label: home, href: "/" });
  }

  // Build crumbs from layers, skipping the root layout (index 0)
  for (let i = 1; i < state.layers.length; i++) {
    const layer = state.layers[i];
    const route = layer.route as any;

    // Skip index routes (path "/") — they share the parent URL
    if (route?.path === "/" || route?.path === "") continue;

    const label = route?.label ?? toTitleCase(layer.name);
    // Use router.path() to resolve dynamic params (e.g. :userId → 3)
    const href = router.path(layer.name);
    crumbs.push({ label, href });
  }

  if (crumbs.length === 0) return null;

  const sep = separator ?? <IconChevronRight size={12} color="#9ca3af" />;

  return (
    <Flex gap={"sm"} {...groupProps}>
      {crumbs.map((crumb, i) => (
        <Flex align={"center"} key={crumb.href} gap={"sm"}>
          {i > 0 && sep}
          {i < crumbs.length - 1 ? (
            <ActionButton anchor href={crumb.href} size={size} c="dimmed">
              {crumb.label}
            </ActionButton>
          ) : (
            <Text size={size} fw={500}>
              {crumb.label}
            </Text>
          )}
        </Flex>
      ))}
    </Flex>
  );
};

export default Breadcrumbs;
