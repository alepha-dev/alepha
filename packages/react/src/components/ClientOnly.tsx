import { type ReactNode, useEffect, useState } from "react";

export interface ClientOnlyProps {
	children: ReactNode;
	fallback?: ReactNode;
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
 */
const ClientOnly = (props: ClientOnlyProps) => {
	const [mounted, setMounted] = useState(false);

	useEffect(() => setMounted(true), []);

	return mounted ? props.children : props.fallback;
};

export default ClientOnly;
