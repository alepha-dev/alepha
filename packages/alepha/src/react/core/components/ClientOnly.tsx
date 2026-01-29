import {
  type PropsWithChildren,
  type ReactNode,
  useEffect,
  useState,
} from "react";

export interface ClientOnlyProps {
  fallback?: ReactNode;
  disabled?: boolean;
}

/**
 * A small utility component that renders its children only on the client side.
 *
 * Optionally, you can provide a fallback React node that will be rendered.
 *
 * You should use this component when
 * - you have code that relies on browser-specific APIs
 * - you want to avoid server-side rendering for a specific part of your application
 * - you want to prevent pre-rendering of a component
 *
 * @example
 * ```tsx
 * import { ClientOnly } from "alepha/react";
 *
 * const MyComponent = () => {
 *   // Avoids SSR issues with Date API
 *   return (
 *     <ClientOnly>
 *       {new Date().toLocaleTimeString()}
 *     </ClientOnly>
 *   );
 * }
 * ```
 */
const ClientOnly = (props: PropsWithChildren<ClientOnlyProps>) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (props.disabled) {
    return props.children;
  }

  return mounted ? props.children : props.fallback;
};

export default ClientOnly;
