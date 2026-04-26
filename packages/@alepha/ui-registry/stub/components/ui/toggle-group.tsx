import type { ReactNode } from "react";

export interface ToggleGroupProps {
  type: "single" | "multiple";
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}

export const ToggleGroup: (props: ToggleGroupProps) => any = () => null;
export const ToggleGroupItem: (props: {
  value: string;
  disabled?: boolean;
  children?: ReactNode;
}) => any = () => null;
