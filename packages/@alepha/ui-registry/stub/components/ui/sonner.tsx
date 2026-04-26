import type { ComponentProps } from "react";

export const Toaster: (props: ComponentProps<"section">) => any = () => null;
export const toast: {
  (message: string): void;
  success: (message: string, options?: { description?: string }) => void;
  error: (message: string, options?: { description?: string }) => void;
  info: (message: string, options?: { description?: string }) => void;
  warning: (message: string, options?: { description?: string }) => void;
  message: (message: string, options?: { description?: string }) => void;
} = Object.assign(() => {}, {
  success: () => {},
  error: () => {},
  info: () => {},
  warning: () => {},
  message: () => {},
});
