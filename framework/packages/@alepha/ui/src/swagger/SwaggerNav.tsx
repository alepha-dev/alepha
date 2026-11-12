import { useI18n } from "alepha/react/i18n";
import { Lock, Search } from "lucide-react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../core/InputGroup.tsx";
import { cn } from "../core/utils.ts";
import type { OpenApiSpec } from "./OpenApiSpec.ts";
import { SwaggerMethodBadge } from "./SwaggerMethodBadge.tsx";

export interface SwaggerNavProps {
  spec: OpenApiSpec;
  query: string;
  onQueryChange: (query: string) => void;
  selected?: string;
  onSelect: (id: string) => void;
}

/**
 * The explorer's index: a search box over every operation, then the
 * operations grouped by tag. The search box filters as you type; it is a
 * view filter with nothing to submit, hence a plain input rather than a form
 * control.
 */
export const SwaggerNav = (props: SwaggerNavProps) => {
  const { tr } = useI18n();
  const groups = props.spec.groups(props.query);

  return (
    <nav className="flex min-h-0 flex-col gap-3">
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder={tr("swagger.search", { default: "Search operations" })}
          aria-label={tr("swagger.search", { default: "Search operations" })}
        />
      </InputGroup>

      {!groups.length && (
        <p className="text-muted-foreground px-1 text-sm">
          {tr("swagger.search.empty", { default: "No operation matches." })}
        </p>
      )}

      <div className="flex max-h-[40vh] min-h-0 flex-col gap-4 overflow-y-auto md:max-h-none">
        {groups.map((group) => (
          <div key={group.tag} className="flex flex-col gap-0.5">
            <h4 className="text-muted-foreground px-2 text-xs font-medium tracking-wide uppercase">
              {group.tag}
            </h4>
            <ul className="flex flex-col">
              {group.entries.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => props.onSelect(entry.id)}
                    aria-current={
                      props.selected === entry.id ? "true" : undefined
                    }
                    className={cn(
                      "hover:bg-hover flex w-full items-center gap-2 rounded-md px-2 py-1 text-start",
                      props.selected === entry.id && "bg-muted",
                      entry.operation.deprecated && "opacity-60",
                    )}
                  >
                    <SwaggerMethodBadge method={entry.method} />
                    <span
                      title={entry.path}
                      className="min-w-0 flex-1 truncate font-mono text-xs"
                    >
                      {entry.path}
                    </span>
                    {props.spec.isSecured(entry.operation) && (
                      <Lock className="text-muted-foreground size-3 shrink-0" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
};
