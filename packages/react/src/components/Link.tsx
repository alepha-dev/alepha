import React from "react";
import type { AnchorHTMLAttributes } from "react";
import { RouterContext } from "../contexts/RouterContext";
import type { PageDescriptor } from "../descriptors/$page.ts";
import { useRouter } from "../hooks/useRouter";

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
	to: string | PageDescriptor;
	children?: React.ReactNode;
}

const Link = (props: LinkProps) => {
	React.useContext(RouterContext);

	const to = typeof props.to === "string" ? props.to : props.to.options.path;
	if (!to) {
		return null;
	}

	const can = typeof props.to === "string" ? undefined : props.to.options.can;
	if (can && !can()) {
		console.log("I cannot go to", to);
		return null;
	}

	const name = typeof props.to === "string" ? undefined : props.to.options.name;

	const router = useRouter();
	return (
		<a {...router.createAnchorProps(to)} {...props}>
			{props.children ?? name}
		</a>
	);
};

export default Link;
