import type { ReactNode } from "react";

export interface AuthCardFrameProps {
  children: ReactNode;
}

/**
 * The frame around an auth form's card: a darker shell a pixel wider on
 * the sides and thicker on top, so the card reads as seated in it. Every
 * auth screen wears it (sign in, register, reset password, verify email),
 * so they look like one product. A new auth screen's card goes in it too.
 */
export const AuthCardFrame = (props: AuthCardFrameProps) => {
  return (
    <div className="w-full rounded-[calc(var(--radius-xl)+2px)] bg-neutral-600 px-px pt-1 pb-0.5 shadow-sm dark:bg-neutral-700">
      {props.children}
    </div>
  );
};
