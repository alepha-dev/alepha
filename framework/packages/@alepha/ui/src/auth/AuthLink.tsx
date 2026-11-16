import type { ComponentProps } from "react";

import { TextLink } from "../core/TextLink.tsx";

export interface AuthLinkProps extends ComponentProps<"a"> {}

/**
 * A text link of the auth screens ("Forgot password?", "Don't have an
 * account? Sign up"): the shared `TextLink`, so these read like every other
 * text link of an app. The whole sentence is the link, never its last two
 * words.
 */
export const AuthLink = (props: AuthLinkProps) => <TextLink {...props} />;
