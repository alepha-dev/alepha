import { ActionButton, type ActionProps } from "@alepha/mantine";

export type MeLayoutNavLinkProps = ActionProps & {
  href: string;
};

const MeLayoutNavLink = (props: MeLayoutNavLinkProps) => {
  const { children, ...rest } = props;

  return (
    <ActionButton
      size={"xs"}
      textVisibleFrom={"sm"}
      justify={"flex-start"}
      variant={"minimal"}
      {...rest}
    >
      {children}
    </ActionButton>
  );
};

export default MeLayoutNavLink;
