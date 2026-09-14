import { OTPInput, OTPInputContext } from "input-otp";
import { MinusIcon } from "lucide-react";
import * as React from "react";

import { cn } from "../core/utils.ts";

export type InputOTPProps = React.ComponentProps<typeof OTPInput> & {
  containerClassName?: string;
};

const InputOTP = (props: InputOTPProps) => {
  const { className, containerClassName, ...rest } = props;
  return (
    <OTPInput
      data-slot="input-otp"
      containerClassName={cn(
        "flex items-center has-disabled:opacity-50",
        containerClassName,
      )}
      spellCheck={false}
      className={cn("disabled:cursor-not-allowed", className)}
      {...rest}
    />
  );
};

export type InputOTPGroupProps = React.ComponentProps<"div">;

const InputOTPGroup = (props: InputOTPGroupProps) => {
  const { className, ...rest } = props;
  return (
    <div
      data-slot="input-otp-group"
      className={cn(
        "has-aria-invalid:border-destructive has-aria-invalid:ring-destructive/20 dark:has-aria-invalid:ring-destructive/40 flex items-center rounded-lg has-aria-invalid:ring-3",
        className,
      )}
      {...rest}
    />
  );
};

export type InputOTPSlotProps = React.ComponentProps<"div"> & {
  index: number;
};

const InputOTPSlot = (props: InputOTPSlotProps) => {
  const { index, className, ...rest } = props;
  const inputOTPContext = React.useContext(OTPInputContext);
  const { char, hasFakeCaret, isActive } = inputOTPContext?.slots[index] ?? {};

  return (
    <div
      data-slot="input-otp-slot"
      data-active={isActive}
      className={cn(
        "border-input aria-invalid:border-destructive data-[active=true]:border-ring data-[active=true]:ring-ring/50 data-[active=true]:aria-invalid:border-destructive data-[active=true]:aria-invalid:ring-destructive/20 dark:bg-input/30 dark:data-[active=true]:aria-invalid:ring-destructive/40 relative flex size-8 items-center justify-center border-y border-r text-sm transition-all outline-none first:rounded-l-lg first:border-l last:rounded-r-lg data-[active=true]:z-10 data-[active=true]:ring-3",
        className,
      )}
      {...rest}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="animate-caret-blink bg-foreground h-4 w-px duration-1000" />
        </div>
      )}
    </div>
  );
};

export type InputOTPSeparatorProps = React.ComponentProps<"div">;

const InputOTPSeparator = (props: InputOTPSeparatorProps) => {
  return (
    <div
      data-slot="input-otp-separator"
      className="flex items-center [&_svg:not([class*='size-'])]:size-4"
      role="separator"
      {...props}
    >
      <MinusIcon />
    </div>
  );
};

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator };
