import { AutomationAccess, ProjectController } from "@lore/core/api";
import { createPresetRanks } from "@lore/core/testing";
import { ProjectShellRegistry, visibleSettingsTabs } from "@lore/core/web";
import { WorkShell } from "@lore/plan/web";
import { Alepha } from "alepha";
import { RankService } from "alepha/api/organizations";
import type { UserAccountToken } from "alepha/security";
import { afterEach, beforeEach, describe, it } from "vitest";

import { bootLore } from "./fixtures/bootLore.ts";
import {
  createTestMember,
  createTestProject,
  TestEntityRepositories,
} from "./fixtures/entities.ts";

const AUTOMATION = [
  "automation:read",
  "automation:write",
  "automation:manage",
] as const;

/**
 * What the sidebar is told against what the API answers, for an identity
 * holding `ownership: false` (#Q3022).
 *
 * The API refuses such a caller outside the project, and narrows one inside it
 * by rank: `automation-access.spec.ts` pins that refusal on purpose. So the set
 * `getProjectBySlug` sends has to say the same, or the sidebar offers a page
 * whose every read is refused.
 */
describe("automation permissions for a privileged identity", () => {
  let alepha: Alepha;
  let entities: TestEntityRepositories;

  const shellContainer = Alepha.create();
  shellContainer.inject(WorkShell);
  const shell = shellContainer.inject(ProjectShellRegistry);

  beforeEach(async () => {
    alepha = Alepha.create({
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:", SERVER_PORT: 0 },
    });
    bootLore(alepha, ["api"]);
    entities = alepha.inject(TestEntityRepositories);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  const setup = async () => {
    const project = await createTestProject(alepha, {
      capabilities: [{ key: "work", options: {} }],
    });
    await entities.users.updateById(project.createdBy, { roles: ["user"] });
    const account = await entities.users.create({ roles: ["admin"] });
    const admin = {
      id: account.id,
      roles: ["admin"],
      ownership: false,
    } as UserAccountToken;
    return { project, admin };
  };

  /**
   * The real response, then the real gate, for every automation permission:
   * what is told is what is allowed, in both directions.
   */
  const told = async (
    project: Awaited<ReturnType<typeof createTestProject>>,
    user: UserAccountToken,
  ) => {
    const { data } = await alepha
      .inject(ProjectController)
      .getProjectBySlug.fetch({ params: { slug: project.slug! } }, { user });
    const access = alepha.inject(AutomationAccess);
    const allowed: string[] = [];
    for (const permission of AUTOMATION) {
      const refused = await access
        .assert(project.id, user, permission)
        .then(() => false)
        .catch(() => true);
      if (!refused) allowed.push(permission);
    }
    return {
      claimed: data.permissions.filter((it) => it.startsWith("automation:")),
      allowed,
      // The sidebar's entries and its Settings sections' pages: Automations
      // is a Settings section, not a sidebar entry.
      nav: [
        ...shell
          .offeredNav(data, {
            routeName: "projectQuests",
            params: {},
            get: () => undefined,
          })
          .map((entry) => entry.route),
        ...shell
          .settingsSections()
          .flatMap((section) => visibleSettingsTabs(section, data))
          .map((tab) => tab.route),
      ],
      everythingElse: data.permissions.filter(
        (it) => !it.startsWith("automation:"),
      ),
    };
  };

  it("claims nothing and offers no entry outside the project", async ({
    expect,
  }) => {
    const { project, admin } = await setup();

    const { claimed, allowed, nav, everythingElse } = await told(
      project,
      admin,
    );

    expect(allowed).toEqual([]);
    expect(claimed).toEqual(allowed);
    expect(nav).not.toContain("projectAutomations");
    // The bypass is otherwise untouched: only what the API refuses left.
    expect(everythingElse).toContain("project:delete");
  });

  it("claims nothing under a rank without automation:read", async ({
    expect,
  }) => {
    const { project, admin } = await setup();
    await alepha.inject(RankService).save(
      project.organizationId!,
      {
        key: "reader",
        name: "Reader",
        permissions: ["project:read", "quest:read"],
      },
      { id: project.createdBy } as UserAccountToken,
    );
    await createTestMember(alepha, project, admin.id, { rank: "reader" });

    const { claimed, allowed, nav } = await told(project, admin);

    expect(allowed).toEqual([]);
    expect(claimed).toEqual(allowed);
    expect(nav).not.toContain("projectAutomations");
  });

  it("claims exactly what the rank grants inside the project", async ({
    expect,
  }) => {
    const { project, admin } = await setup();
    await createPresetRanks(alepha, project.id);
    await createTestMember(alepha, project, admin.id, { rank: "viewer" });

    const { claimed, allowed, nav } = await told(project, admin);

    expect(allowed).toEqual(["automation:read"]);
    expect(claimed).toEqual(allowed);
    expect(nav).toContain("projectAutomations");
  });
});
