import type { ReactNode } from "react";

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  children?: ReactNode;
}

export const Select: (props: SelectProps) => any = () => null;
export const SelectTrigger: (props: {
  id?: string;
  className?: string;
  children?: ReactNode;
}) => any = () => null;
export const SelectValue: (props: { placeholder?: string }) => any = () => null;
export const SelectContent: (props: { children?: ReactNode }) => any = () =>
  null;
export const SelectItem: (props: {
  value: string;
  children?: ReactNode;
}) => any = () => null;
export const SelectGroup: (props: { children?: ReactNode }) => any = () => null;
export const SelectLabel: (props: { children?: ReactNode }) => any = () => null;
