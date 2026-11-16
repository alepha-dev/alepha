import { Badge, Card, CardContent } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import { CRITERION_METHOD_LABEL_KEYS } from "./useCaseLabels.ts";

export interface UseCaseCriteriaProps {
  useCase: UseCaseResource;
}

/**
 * Acceptance criteria (#E153): each with its key, how it is verified, the
 * alternative it belongs to, and its Given / When / Then (or its sentence).
 * The requirement each verifies arrives with requirements.
 */
const UseCaseCriteria = (props: UseCaseCriteriaProps) => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <h2 className="font-semibold">{tr("requirements.usecase.criteria")}</h2>
        {props.useCase.criteria.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {tr("requirements.usecase.criteria.empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="criteria">
            {props.useCase.criteria.map((c) => (
              <li
                key={c.key}
                className="flex flex-col gap-1 border-b pb-3 text-sm last:border-0"
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{c.key}</span>
                  <Badge variant="tint">
                    {tr(CRITERION_METHOD_LABEL_KEYS[c.method])}
                  </Badge>
                  {c.alternativeKey ? (
                    <span className="text-muted-foreground text-xs">
                      {c.alternativeKey}
                    </span>
                  ) : null}
                </div>
                {c.text ? (
                  <p>{c.text}</p>
                ) : (
                  <dl className="grid grid-cols-[3.5rem_1fr] gap-x-2">
                    {c.givenText ? (
                      <>
                        <dt className="font-semibold">
                          {tr("requirements.usecase.given")}
                        </dt>
                        <dd>{c.givenText}</dd>
                      </>
                    ) : null}
                    {c.whenText ? (
                      <>
                        <dt className="font-semibold">
                          {tr("requirements.usecase.when")}
                        </dt>
                        <dd>{c.whenText}</dd>
                      </>
                    ) : null}
                    {c.thenText ? (
                      <>
                        <dt className="font-semibold">
                          {tr("requirements.usecase.then")}
                        </dt>
                        <dd>{c.thenText}</dd>
                      </>
                    ) : null}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};

export default UseCaseCriteria;
