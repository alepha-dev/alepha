import type { ReactNode } from "react";

export interface SwitchProps {
  id?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
  children?: ReactNode;
}

export const Switch: (props: SwitchProps) => any = () => null;
