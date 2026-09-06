import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import { registerAndVerify } from "./_helpers";

/**
 * The roadmap, from the three audiences it has: a stranger with no account, a
 * member, and a signed-in stranger.
 *
 * **The public half is worth more than the rest of this epic combined**,
 * because a regression there is visible to the internet rather than to a
 * member. That is why the anonymous assertions are the bulk of this file and
 * why they are driven the way they are.
 *
 * ## ⚠️ Anonymous means the `request` fixture, never the page
 *
 * Alepha patches the browser's `fetch` to attach the session bearer, so a
 * page-driven request proves nothing about anonymous access: it would pass
 * with a session attached, and pass again after somebody accidentally
 * required one. Playwright's `request` fixture is a separate context with its
 * own empty cookie jar and no page JavaScript, which is exactly what a
 * stranger's browser and a crawler look like. `e2e/apps.spec.ts` does the
 * same thing for the opposite case.
 *
 * ## ⚠️ Three projects, and no visibility is ever flipped
 *
 * The obvious test is "flip public to off, ask again, expect 404". It would
 * be flaky, and not for a reason a retry fixes: the response carries
 * `max-age=60`, so a browser or a CDN may legitimately still be holding the
 * old body. That window is a decided, disclosed property (#1560), not a bug.
 * Three projects created once at their final visibility sidestep it entirely
 * rather than papering over it with a retry loop that would hide a real
 * regression later.
 *
 * ## ⚠️ Two mechanical traps this repo's e2e keeps hitting
 *
 * Calls are multiplexed through `POST /api/_batch`, so `waitForResponse` on a
 * per-action URL never fires - assert on rendered state. And Base UI leaves
 * `pointer-events: none` on `<body>` after a popover closes, so a click
 * straight after a dismiss silently misses. Neither bites here, because setup
 * goes over the API and the page is only ever read.
 */

/**
 * POST to a name-derived action route.
 *
 * Direct paths rather than `_helpers`' `apiPost`, which resolves an action
 * through the SSR-injected `apiLinks` map: that map is scoped to what the
 * CURRENT page declares, and this spec does its setup from `/`, where
 * `createProject` is not in it. It also has nowhere to put a path parameter -
 * the same reason `setProjectFeature` uses a direct URL. Action routes are
 * name-derived, so the path is the property key.
 */
const post = async <T>(page: Page, path: string, body: unknown): Promise<T> =>
  (await page.evaluate(
    async ({ path, body }) => {
      const r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      return r.json();
    },
    { path, body },
  )) as T;

interface Seeded {
  id: number;
  slug: string;
}

test.describe("Roadmap", () => {
  test("public to a stranger, members to a member, off to nobody", async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    // A random tail as well as the clock, the way `newUserContext` does it.
    // Every name in this spec is derived from it, and two of them have to be
    // globally unique: an email (registering the same one twice picks up the
    // first registration's already-used verification code) and a project
    // slug. `Date.now()` alone collides under `--repeat-each`, which is what
    // this file is worth re-running with.
    const t = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await registerAndVerify(page, `roadmap${t}@example.com`, "RoadTest123!");

    /**
     * A project at a given visibility, with one open release, one PLANNED
     * epic attached to it, and one quest inside that epic.
     *
     * Over the API rather than the wizard: this spec is about what the
     * roadmap publishes, and three trips through a three-step form would be
     * two minutes spent proving something `project-wizard.spec.ts` already
     * proves.
     */
    const seed = async (
      label: string,
      visibility: "off" | "members" | "public",
    ): Promise<Seeded> => {
      const project = await post<{ id: number; slug: string }>(
        page,
        "/api/createProject",
        { title: `RM${t}${label}`.slice(0, 24) },
      );

      const release = await post<{ id: number }>(
        page,
        `/api/createRelease/${project.id}`,
        {
          tag: `0.1.0`,
          title: `First light ${label}`,
          targetDate: "2027-03-01T00:00:00.000Z",
        },
      );

      // Left `planned`, which is the state the roadmap exists to show: an
      // epic that is specified and not started.
      const epic = await post<{ id: number }>(
        page,
        `/api/createEpic/${project.id}`,
        { title: `Epic${t}${label}` },
      );
      await post(page, `/api/updateEpic/${epic.id}`, {
        releaseId: release.id,
      });

      // The quest title is the canary. It exists so the anonymous body can be
      // searched for it, and it must never appear there.
      const quest = await post<{ id: number }>(page, "/api/createQuest", {
        projectId: project.id,
        title: `Quest${t}${label}`,
        description: "",
        area: "lore/quests",
        priority: "high",
        objectives: [],
        attachments: [],
      });
      await post(page, `/api/attachQuest/${epic.id}`, { questId: quest.id });

      await post(page, `/api/updateProjectById/${project.id}`, {
        roadmapVisibility: visibility,
      });

      return { id: project.id, slug: project.slug };
    };

    const open = await seed("p", "public");
    const gated = await seed("m", "members");
    const closed = await seed("o", "off");

    const api = (slug: string) =>
      `${baseURL}/api/projects/by-slug/${slug}/roadmap`;
    const pageUrl = (slug: string) => `${baseURL}/${slug}/roadmap`;

    await test.step("a stranger reads the public roadmap", async () => {
      const res = await request.get(api(open.slug));
      expect(res.status()).toBe(200);

      const body = (await res.json()) as {
        project: { title: string };
        releases: Array<{ tag?: string; epics: Array<{ title: string }> }>;
      };

      expect(body.releases.map((release) => release.tag)).toEqual(["0.1.0"]);
      expect(body.releases[0].epics.map((epic) => epic.title)).toEqual([
        `Epic${t}p`,
      ]);
    });

    /**
     * ⚠️ The assertion that matters most in this file.
     *
     * The unit spec pins the response's key set; this pins its CONTENT
     * against the real database, through the real HTTP stack, with no
     * session - which is the only place a serializer, a schema and a query
     * can disagree in a way that reaches the internet.
     */
    await test.step("the anonymous body carries nothing it should not", async () => {
      const res = await request.get(api(open.slug));
      const text = await res.text();

      // The quest inside the published epic. A roadmap reports features, not
      // the backlog.
      expect(text).not.toContain(`Quest${t}p`);
      // The owner, by either name.
      expect(text).not.toContain(`roadmap${t}@example.com`);

      // No id of any kind, declared or otherwise. `project.title` is the one
      // field beyond releases and epics, and it is not an identifier.
      const body = (await res.json()) as Record<string, unknown>;
      const keys = new Set<string>();
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        if (node && typeof node === "object") {
          for (const [key, value] of Object.entries(node)) {
            keys.add(key);
            walk(value);
          }
        }
      };
      walk(body);

      for (const forbidden of [
        "id",
        "projectId",
        "releaseId",
        "epicId",
        "createdBy",
        "createdAt",
        "updatedAt",
        "shortId",
        "quests",
      ]) {
        expect([...keys]).not.toContain(forbidden);
      }
    });

    /**
     * The half a functional assertion through the API would miss entirely,
     * and the reason the route is unguarded at all: a crawler and a stranger
     * get real HTML with the content in it, not an empty shell that fills in
     * on the client.
     */
    await test.step("the page is server-rendered, not a client-filled shell", async () => {
      const res = await request.get(pageUrl(open.slug), {
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        },
      });
      expect(res.status()).toBe(200);

      const html = await res.text();
      expect(html).toContain("0.1.0");
      expect(html).toContain(`Epic${t}p`);
      expect(html).toContain(`RM${t}p`);
      // And still nothing it should not carry, on this path either.
      expect(html).not.toContain(`Quest${t}p`);
    });

    await test.step("members and off are 404 to a stranger, identically", async () => {
      for (const project of [gated, closed]) {
        expect((await request.get(api(project.slug))).status()).toBe(404);
        // Not a soft 404: `/:projectSlug/roadmap` matches any root segment,
        // so a 200 carrying an error would be an unbounded surface for a
        // crawler to index.
        expect((await request.get(pageUrl(project.slug))).status()).toBe(404);
      }

      // A slug nobody has ever registered answers exactly as a hidden
      // roadmap does. A different status, or a different message, would
      // confirm the project exists.
      const message = async (url: string) => {
        const res = await request.get(url);
        expect(res.status()).toBe(404);
        const body = (await res.json()) as { message?: string };
        return body.message;
      };
      expect(await message(api(`no-such-${t}`))).toBe(
        await message(api(closed.slug)),
      );
    });

    await test.step("a member reads the members-only roadmap", async () => {
      await page.goto(`/${gated.slug}/roadmap`);
      await page.waitForLoadState("networkidle");

      await expect(page.getByText("0.1.0").first()).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText(`Epic${t}m`).first()).toBeVisible({
        timeout: 10_000,
      });

      // ⚠️ The planned epic renders WITH its status. Without the chip its
      // empty bar reads as stalled rather than as not begun, which is the
      // most misleading thing a roadmap can say.
      await expect(page.getByText("Planned").first()).toBeVisible({
        timeout: 10_000,
      });

      // Estimated, never due. Nothing enforces a target date and no cron
      // reads it; the wording is the whole safeguard.
      await expect(page.getByText(/Estimated/).first()).toBeVisible({
        timeout: 10_000,
      });

      // The backlog is not a roadmap.
      await expect(page.getByText(`Quest${t}m`)).toHaveCount(0);
    });

    await test.step("off is 404 for a member too", async () => {
      await page.goto(`/${closed.slug}/roadmap`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("404").first()).toBeVisible({
        timeout: 10_000,
      });
    });

    /**
     * The one thing a member's roadmap has that nobody else's does.
     *
     * The release detail page lives under `/:projectSlug`, which carries
     * `$secure()`, so a link offered to a stranger is an invitation to a
     * login screen. `member` is a field the endpoint returns rather than
     * something the page infers, precisely so this stays decidable.
     */
    await test.step("the release links out for a member, and for nobody else", async () => {
      await page.goto(`/${gated.slug}/roadmap`);
      await page.waitForLoadState("networkidle");
      await expect(
        page.locator(`a[href="/${gated.slug}/releases/0.1.0"]`).first(),
      ).toBeVisible({ timeout: 10_000 });

      // The anonymous render of the public roadmap carries no such link, and
      // is checked in the HTML rather than through a browser so no session
      // can be attached by accident.
      const html = await (await request.get(pageUrl(open.slug))).text();
      expect(html).not.toContain(`/${open.slug}/releases/`);
    });
  });
});
