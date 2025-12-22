import { t } from "alepha";
import { $entity, $repository, pg } from "alepha/orm";
import { $action } from "alepha/server";

const viewEntity = $entity({
  name: "views",
  schema: t.object({
    id: pg.primaryKey(),
    name: t.text(),
    count: t.integer(),
  }),
});

export class CountApi {
  views = $repository(viewEntity);
  inc = $action({
    schema: {
      response: t.object({
        count: t.integer(),
      }),
    },
    handler: async () => {
      const view = await this.views
        .findOne({ where: { name: "home" } })
        .catch(() => undefined);

      if (view) {
        view.count += 1;
        await this.views.save(view);
        return view;
      }

      await this.views.create({ name: "home", count: 1 });
      return {
        count: 1,
      };
    },
  });
}
