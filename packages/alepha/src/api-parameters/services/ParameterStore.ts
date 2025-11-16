import { t } from "alepha";
import { $topic } from "alepha/topic";

export class ParameterStore {
  protected readonly parameters = new Map<
    string,
    {
      current: any;
      next?: any;
    }
  >();

  public readonly onNewParameter = $topic({
    schema: {
      payload: t.object({
        name: t.text(),
      }),
    },
    handler: async ({ payload }) => {
      // this.synchronize( payload.name );
    },
  });
}
