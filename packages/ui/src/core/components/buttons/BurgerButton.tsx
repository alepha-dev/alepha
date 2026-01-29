import { Burger, type BurgerProps } from "@mantine/core";
import { useStore } from "alepha/react";
import { alephaSidebarAtom } from "../../atoms/alephaSidebarAtom.ts";

export interface BurgerButtonProps extends BurgerProps {}

const BurgerButton = (props: BurgerButtonProps) => {
  const [sidebar, setSidebar] = useStore(alephaSidebarAtom);

  return (
    <Burger
      opened={sidebar.opened}
      onClick={() => setSidebar({ ...sidebar, opened: !sidebar.opened })}
      hiddenFrom="sm"
      size="sm"
      {...props}
    />
  );
};

export default BurgerButton;
