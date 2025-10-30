import { Alepha } from "@alepha/core";
import { dayjs } from "@alepha/datetime";
import { describe, expect, it } from "vitest";
import { TaskController } from "../src/api/controllers/TaskController.ts";

describe("TaskController", () => {
  it("should create and find tasks", async () => {
    const alepha = Alepha.create();
    const ctrl = alepha.inject(TaskController);
    await alepha.start();

    expect(await ctrl.createTask({ body: { name: "New Task" } })).toEqual([
      {
        id: expect.any(String),
        createdAt: expect.any(dayjs),
        name: "New Task",
      },
    ]);
  });
});
