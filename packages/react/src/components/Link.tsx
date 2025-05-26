import { OPTIONS } from "@alepha/core";
import React from "react";
import type { AnchorHTMLAttributes } from "react";
import { RouterContext } from "../contexts/RouterContext.ts";
import type { PageDescriptor } from "../descriptors/$page.ts";
import { useRouter } from "../hooks/useRouter.ts";

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
	to: string | PageDescriptor;
	children?: React.ReactNode;
}

const Link = (props: LinkProps) => {
	React.useContext(RouterContext);

	const to = typeof props.to === "string" ? props.to : props.to[OPTIONS].path;
	if (!to) {
		return null;
	}

	const can = typeof props.to === "string" ? undefined : props.to[OPTIONS].can;
	if (can && !can()) {
		return null;
	}

	const name =
		typeof props.to === "string" ? undefined : props.to[OPTIONS].name;

	const router = useRouter();
	return (
		<a {...router.anchor(to)} {...props}>
			{props.children ?? name}
		</a>
	);
};

export default Link;
