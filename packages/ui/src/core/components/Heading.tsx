import type { ReactNode } from "react";
import type { AlephaIntent } from "../interfaces/AlephaIntent.ts";

export type HeadingProps = {
  title: string | ReactNode;
  description?: string | ReactNode;
  icon?: ReactNode;
  intent?: AlephaIntent;
  loading?: boolean;
  ellipsis?: boolean;
  fill?: boolean;
  tag?: string | ReactNode;
};

const Heading = (props: HeadingProps) => {
  return <h1>Heading</h1>;
};

export default Heading;
