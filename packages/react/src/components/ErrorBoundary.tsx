import React, {
	type ReactNode,
	type ErrorInfo,
	type PropsWithChildren,
} from "react";

/**
 * Props for the ErrorBoundary component.
 */
export interface ErrorBoundaryProps {
	/**
	 * Fallback React node to render when an error is caught.
	 * If not provided, a default error message will be shown.
	 */
	fallback: (error: Error) => ReactNode;

	/**
	 * Optional callback that receives the error and error info.
	 * Use this to log errors to a monitoring service.
	 */
	onError?: (error: Error, info: ErrorInfo) => void;
}

/**
 * State of the ErrorBoundary component.
 */
interface ErrorBoundaryState {
	error?: Error;
}

/**
 * A reusable error boundary for catching rendering errors
 * in any part of the React component tree.
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

	render(): ReactNode {
		if (this.state.error) {
			return this.props.fallback(this.state.error);
		}

		return this.props.children;
	}
}

export default ErrorBoundary;
