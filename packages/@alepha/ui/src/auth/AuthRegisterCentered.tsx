import * as React from "react";

void React;

export interface AuthRegisterCenteredProps {
  children: React.ReactNode;
}

export const AuthRegisterCentered = (props: AuthRegisterCenteredProps) => {
  return (
    <div className="flex min-h-svh flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        {props.children}
      </div>
    </div>
  );
};
