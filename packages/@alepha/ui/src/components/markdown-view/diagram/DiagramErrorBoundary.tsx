import * as React from "react";

void React;

import { Component, type ReactNode } from "react";

export interface DiagramErrorBoundaryProps {
  children: ReactNode;
  /** Rendered instead of the children once anything below has thrown. */
  fallback: ReactNode;
}

interface DiagramErrorBoundaryState {
  failed: boolean;
}

/**
 * Renders the code block instead of the diagram if anything below throws.
 *
 * The three layers all refuse rather than throw, so this should never fire,
 * which is exactly why it exists. `MarkdownView` is mounted on every quest,
 * epic, comment and folio in the app, and a bug in the emitter must cost the
 * one fence it is drawing, never the page it sits on.
 *
 * A class is not a style choice here: `componentDidCatch` has no hook.
 */
export class DiagramErrorBoundary extends Component<
  DiagramErrorBoundaryProps,
  DiagramErrorBoundaryState
> {
  state: DiagramErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): DiagramErrorBoundaryState {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
