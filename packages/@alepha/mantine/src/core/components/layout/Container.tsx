import {
  Container as MantineContainer,
  type ContainerProps as MantineContainerProps,
} from "@mantine/core";
import { forwardRef } from "react";

export interface ContainerProps extends MantineContainerProps {}

const Container = forwardRef<HTMLDivElement, ContainerProps>((props, ref) => {
  return <MantineContainer ref={ref} {...props} />;
});

Container.displayName = "Container";

export default Container;
