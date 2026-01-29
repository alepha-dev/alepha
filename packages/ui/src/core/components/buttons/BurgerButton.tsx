import { Burger, type BurgerProps } from "@mantine/core";
import { useStore } from "alepha/react";

export interface BurgerButtonProps extends BurgerProps {}

const BurgerButton = (props: BurgerButtonProps) => {
  const [opened, setOpened] = useStore("alepha.ui.sidebar.opened");

  return (
    <Burger
      opened={opened}
      onClick={() => setOpened(!opened)}
      hiddenFrom="sm"
      size="sm"
      {...props}
    />
  );
};

export default BurgerButton;
