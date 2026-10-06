import { $context } from "alepha";
import {
  $page,
  type PageConfigSchema,
  type PagePrimitive,
  type PagePrimitiveOptions,
  type TPropsDefault,
  type TPropsParentDefault,
} from "alepha/react/router";

import { ProjectRouter } from "./ProjectRouter.ts";

/**
 * `$page` already parented to the project layout, `/:projectSlug`: the
 * one-call form of "a page inside a project", modelled on `@alepha/ui`'s
 * `$pageAdmin`.
 *
 * It exists so the layout never lists another module's page (#E75, #Q2609):
 * a page joins the project by declaring its parent, from whichever class or
 * package declares it. `ReactPageProvider` collects every `$page` in the
 * container and adopts each page whose `parent` is the target, so the module
 * that declares the page only has to be registered, in BOTH entries.
 *
 * ⚠️ Two things the type system does not check, and `test/app-routes.spec.ts`
 * does: a page name is unique across the whole container (`page(name)`
 * returns the first match), and the param at each path position has one name
 * (the router keeps one key per position).
 *
 * A plain function wrapping `$page`, not a primitive of its own.
 */
export const $pageProject = <
  TConfig extends PageConfigSchema = PageConfigSchema,
  TProps extends object = TPropsDefault,
  TPropsParent extends object = TPropsParentDefault,
>(
  options: Omit<PagePrimitiveOptions<TConfig, TProps, TPropsParent>, "parent">,
): PagePrimitive<TConfig, TProps, TPropsParent> => {
  const { alepha } = $context();
  return $page<TConfig, TProps, TPropsParent>({
    ...options,
    parent: alepha.inject(ProjectRouter).project as PagePrimitive<
      PageConfigSchema,
      TPropsParent,
      any
    >,
  });
};

/**
 * `$page` parented to the project's settings layout, `/:projectSlug/settings`:
 * a settings section. See {@link $pageProject}.
 */
export const $pageProjectSettings = <
  TConfig extends PageConfigSchema = PageConfigSchema,
  TProps extends object = TPropsDefault,
  TPropsParent extends object = TPropsParentDefault,
>(
  options: Omit<PagePrimitiveOptions<TConfig, TProps, TPropsParent>, "parent">,
): PagePrimitive<TConfig, TProps, TPropsParent> => {
  const { alepha } = $context();
  return $page<TConfig, TProps, TPropsParent>({
    ...options,
    parent: alepha.inject(ProjectRouter).projectSettings as PagePrimitive<
      PageConfigSchema,
      TPropsParent,
      any
    >,
  });
};
