export interface CheckboxProps {
  id?: string;
  checked?: boolean | "indeterminate";
  defaultChecked?: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
  "aria-label"?: string;
}

export const Checkbox: (props: CheckboxProps) => any = () => null;
