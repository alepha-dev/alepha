import React, {
  type ErrorInfo,
  type PropsWithChildren,
  type ReactNode,
} from "react";

/**
 * Props for the ErrorBoundary component.
 */
export interface ErrorBoundaryProps {
  /**
   * Fallback React node to render when an error is caught.
   * If not provided, a default error message will be shown.
   */
  fallback: (error: Error, reset: () => void) => ReactNode;

  /**
   * Optional callback that receives the error and error info.
   * Use this to log errors to a monitoring service.
   */
  onError?: (error: Error, info: ErrorInfo) => void;

  /**
   * Clear a caught error whenever any of these values changes (compared with
   * `Object.is`, positionally).
   *
   * A boundary that catches has to be told when the reason to fail is gone —
   * otherwise the fallback latches and every later render keeps showing the
   * stale error. The router passes the current path, so navigating away from a
   * page that threw recovers on its own.
   *
   * Unlike remounting via `key`, this clears the error WITHOUT tearing down the
   * children, so unrelated component state survives an ordinary navigation.
   */
  resetKeys?: readonly unknown[];
}

/**
 * State of the ErrorBoundary component.
 */
interface ErrorBoundaryState {
  error?: Error;
}

/**
 * A reusable error boundary for catching rendering errors in any part of the React component tree.
 *
 * It's already included in the Alepha React framework when using page or layout components.
 */
export class ErrorBoundary extends React.Component<
  PropsWithChildren<ErrorBoundaryProps>,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {};
  }

  /**
   * Update state so the next render shows the fallback UI.
   */
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      error,
    };
  }

  /**
   * Lifecycle method called when an error is caught.
   * You can log the error or perform side effects here.
   */
  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (this.props.onError) {
      this.props.onError(error, info);
    }
  }

  /**
   * Recover once the caller signals the failing input is gone.
   */
  componentDidUpdate(prevProps: PropsWithChildren<ErrorBoundaryProps>): void {
    if (!this.state.error) {
      return;
    }

    if (this.hasResetKeyChanged(prevProps.resetKeys, this.props.resetKeys)) {
      this.setState({ error: undefined });
    }
  }

  protected hasResetKeyChanged(
    previous: readonly unknown[] | undefined,
    next: readonly unknown[] | undefined,
  ): boolean {
    if (previous === next) {
      return false;
    }

    if (!previous || !next || previous.length !== next.length) {
      return true;
    }

    return previous.some((value, i) => !Object.is(value, next[i]));
  }

  render(): ReactNode {
    if (this.state.error) {
      const reset = () => {
        this.setState({ error: undefined });
      };
      return this.props.fallback(this.state.error, reset);
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
