export type ToasterProps = {
  theme?: "light" | "dark" | "system";
  [key: string]: any;
};

export const Toaster: (props: ToasterProps) => any = () => null;

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
