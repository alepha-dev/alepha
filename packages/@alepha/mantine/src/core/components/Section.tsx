import { Collapse } from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { ui } from "../constants/ui.ts";
import type { ActionProps } from "./buttons/ActionButton.tsx";
import Flex from "./Flex.tsx";
import SectionHeader, { type SectionHeaderProps } from "./SectionHeader.tsx";

export interface SectionProps
  extends Omit<SectionHeaderProps, "extra" | "size" | "title"> {
  /**
   * Section header title. When omitted, no header is rendered.
   */
  title?: string | ReactNode;
  /**
   * Section content.
   */
  children?: ReactNode;

  /**
   * When `true`, the section body can be collapsed/expanded.
   */
  collapsible?: boolean;

  /**
   * Initial collapsed state. Only applies when `collapsible` is `true`.
   */
  defaultCollapsed?: boolean;

  /**
   * Padding for the section body.
   */
  p?: string | number;
}

const Section = (props: SectionProps) => {
  const {
    children,
    collapsible,
    defaultCollapsed = false,
    title,
    icon,
    tag,
    subtitle,
    actions,
    p = "md",
    ...rest
  } = props;

  const [collapsed, setCollapsed] = useState(
    collapsible ? defaultCollapsed : false,
  );

  const hasHeader = !!title;

  const headerActions: ActionProps[] = [...(actions ?? [])];

  const chevronExtra = collapsible ? (
    <Flex
      centerY
      style={{ cursor: "pointer", flexShrink: 0 }}
      onClick={() => setCollapsed((v) => !v)}
    >
      {collapsed ? (
        <IconChevronRight size={ui.sizes.icon.sm} />
      ) : (
        <IconChevronDown size={ui.sizes.icon.sm} />
      )}
    </Flex>
  ) : undefined;

  return (
    <Flex col surface rounded bordered {...rest}>
      {hasHeader && (
        <Flex
          p="sm"
          px="md"
          style={{
            cursor: collapsible ? "pointer" : undefined,
          }}
          onClick={collapsible ? () => setCollapsed((v) => !v) : undefined}
        >
          <SectionHeader
            icon={icon}
            title={title}
            tag={tag}
            subtitle={subtitle}
            actions={headerActions}
            size="sm"
            extra={chevronExtra}
          />
        </Flex>
      )}
      {collapsible ? (
        <Collapse expanded={!collapsed}>
          <Flex col p={p} {...(hasHeader ? { borderedTop: true } : {})}>
            {children}
          </Flex>
        </Collapse>
      ) : (
        <Flex col p={p} {...(hasHeader ? { borderedTop: true } : {})}>
          {children}
        </Flex>
      )}
    </Flex>
  );
};

export default Section;
