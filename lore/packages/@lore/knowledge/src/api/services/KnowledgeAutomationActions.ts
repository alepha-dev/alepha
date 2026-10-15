import {
  AutomationDomainActions,
  type AutomationDomainHandler,
} from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";

import { FolioController } from "../controllers/FolioController.ts";
import { folios } from "../entities/folios.ts";

/**
 * Append through the normal folio action, pinning its read version so no human
 * content can be replaced between the adapter's read and the controller gate.
 */
export class KnowledgeAutomationActions {
  protected readonly registry = $inject(AutomationDomainActions);
  protected readonly api = $inject(FolioController);
  protected readonly folios = $repository(folios);
  constructor() {
    this.registry.register("appendFolio", {
      prepare: (input) => this.prepare(input),
    });
  }
  protected async prepare(
    input: Parameters<AutomationDomainHandler["prepare"]>[0],
  ): ReturnType<AutomationDomainHandler["prepare"]> {
    const { rule, action, user } = input;
    if (action.kind !== "appendFolio")
      throw new BadRequestError("Expected APPEND_FOLIO");
    const folio = await this.folios.getOne({
      where: { id: action.folio, projectId: rule.projectId },
    });
    if (folio.protected)
      throw new BadRequestError("Cannot append to a protected folio");
    const target = { table: "folios", mode: "update" as const, id: folio.id };
    const result: AutomationDomainHandlerResult = (repository, data) => ({
      result: {
        changed: true,
        folio_id: String(data.id),
        shortId: Number(data.shortId),
      },
      expressions: {
        revision: repository.scalar(
          { id: String(data.id), projectId: rule.projectId },
          "version",
        ),
      },
    });
    if (!action.text)
      return {
        target,
        result,
        unchanged: { folio_id: folio.id },
        invoke: async () => {},
      };
    const content = folio.content
      ? `${folio.content}\n\n${action.text}`
      : action.text;
    return {
      target,
      result,
      invoke: () =>
        this.api.update(
          {
            params: { id: folio.id },
            body: { content, expectedVersion: folio.version },
          },
          { user },
        ),
    };
  }
}

type AutomationDomainHandlerResult = Awaited<
  ReturnType<AutomationDomainHandler["prepare"]>
>["result"];
