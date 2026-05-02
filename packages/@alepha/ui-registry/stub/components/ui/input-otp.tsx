import type { ComponentProps, ReactNode } from "react";

export interface InputOTPProps {
  id?: string;
  className?: string;
  containerClassName?: string;
  maxLength?: number;
  autoComplete?: string;
  value?: string;
  onChange?: (value: string) => void;
  pattern?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}

export const InputOTP: (props: InputOTPProps) => any = () => null;

export const InputOTPGroup: (props: ComponentProps<"div">) => any = () => null;

export const InputOTPSeparator: (props: ComponentProps<"div">) => any = () =>
  null;

export const InputOTPSlot: (
  props: ComponentProps<"div"> & { index: number },
) => any = () => null;
