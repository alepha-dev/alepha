import type { Infer, Page } from "alepha";

import type { showcaseMemberQuerySchema } from "./schemas/showcaseMemberQuerySchema.ts";
import type { showcaseMemberSchema } from "./schemas/showcaseMemberSchema.ts";

/**
 * The showcase's dataset, paged and filtered in memory.
 *
 * This exists so at least one block on the site is driven the way a real app
 * drives it - `AlephaTable` with a `fetch`, paging and sorting on the server -
 * rather than with a static array. A table given `data` never issues a request,
 * so it would prove nothing about the path underneath it.
 */
export class ShowcaseMembers {
  public stats(): { total: number; active: number; teams: number } {
    const rows = this.rows();
    return {
      total: rows.length,
      active: rows.filter((r) => r.status === "active").length,
      teams: new Set(rows.map((r) => r.team)).size,
    };
  }

  /**
   * A comma-joined query value as its entries, dropping the empty ones a
   * trailing comma leaves.
   */
  protected list(value: string | undefined): string[] {
    return String(value ?? "")
      .split(",")
      .filter((entry) => entry.length > 0);
  }

  /**
   * Pages, filters and sorts in memory, then answers in the `Page` shape
   * `AlephaTable` expects. Server-side paging is the whole point: the table
   * holds its fetcher in a ref excluded from its load effect, so a fetcher
   * closing over an array goes stale rather than re-reading it.
   */
  public paginate(query: ShowcaseMemberQuery): Page<ShowcaseMember> {
    const size = Number(query.size ?? 20);
    const number = Number(query.page ?? 0);

    let rows = this.rows();

    const search = String(query.search ?? "").toLowerCase();
    if (search) {
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(search) ||
          r.email.toLowerCase().includes(search),
      );
    }

    // Every operator key is read only alongside its value. An operator with
    // nothing to compare is not a filter, and "not" applied to no status
    // would otherwise be free to mean "everything" or "nothing".
    if (query.status) {
      const not = query.statusOp === "not";
      rows = rows.filter((r) => (r.status === query.status) !== not);
    }

    if (query.team) {
      rows = rows.filter((r) => r.team === query.team);
    }

    // Multi choice: any of the selected roles matches, or with `none`, none
    // of them does. An empty list is not "match nothing" - the key is simply
    // absent when nothing is picked.
    const roles = this.list(query.roles);
    if (roles.length > 0) {
      const none = query.rolesOp === "none";
      rows = rows.filter((r) => roles.includes(r.role) !== none);
    }

    // The three operators a multi-valued column supports: overlaps, contains
    // every one, overlaps none.
    const tags = this.list(query.tags);
    if (tags.length > 0) {
      rows = rows.filter((r) => {
        switch (query.tagsOp) {
          case "all":
            return tags.every((tag) => r.tags.includes(tag));
          case "none":
            return !tags.some((tag) => r.tags.includes(tag));
          default:
            return tags.some((tag) => r.tags.includes(tag));
        }
      });
    }

    // Text contains, on one column only, case-insensitively.
    const email = String(query.email ?? "").toLowerCase();
    if (email) {
      rows = rows.filter((r) => r.email.toLowerCase().includes(email));
    }

    // ⚠️ Alepha's pagination convention is `field` for ascending and `-field`
    // for descending, NOT `field,direction`: a comma separates COLUMNS in a
    // multi-column sort, so `name,desc` asks for a second column called
    // "desc".
    //
    // This parsed the comma form, which made descending a silent no-op:
    // `-name` was read as the whole field name, every row's value came back
    // undefined, every comparison returned 0, and `Array.sort` being stable
    // handed back the original order. The header arrow flipped and the rows
    // did not move.
    const sort = String(query.sort ?? "");
    if (sort) {
      const descending = sort.startsWith("-");
      const key = (descending ? sort.slice(1) : sort) as keyof ShowcaseMember;
      rows = [...rows].sort((a, b) => {
        const left = String(a[key] ?? "");
        const right = String(b[key] ?? "");
        return descending
          ? right.localeCompare(left)
          : left.localeCompare(right);
      });
    }

    const offset = number * size;
    const content = rows.slice(offset, offset + size);
    const totalPages = Math.max(1, Math.ceil(rows.length / size));

    return {
      content,
      page: {
        number,
        size,
        offset,
        numberOfElements: content.length,
        totalElements: rows.length,
        totalPages,
        isEmpty: content.length === 0,
        isFirst: number === 0,
        isLast: number >= totalPages - 1,
      },
    };
  }

  /**
   * Deterministic on purpose. Random names would make every prerender produce a
   * different page, so the deployed HTML would churn on every build and the e2e
   * suite would have nothing stable to assert.
   *
   * Which is also why this stayed a literal list when it grew from 24 to 75
   * rather than moving to `alepha/fake`. A seeded faker is deterministic within
   * a build but not ACROSS versions: bumping `@faker-js/faker` would silently
   * rewrite every prerendered row here. `FakeProvider` also keeps its faker
   * `protected` and generates whole rows from a schema, so the only reachable
   * generator is the `fake` singleton, whose own docs call reseeding it from
   * application code a footgun - and generating from the schema would break
   * the one thing that makes these rows read as real, which is that the email
   * is derived from the name.
   *
   * 75 is enough that a full-height table scrolls its own body at any page
   * size the footer offers. The first 24 are unchanged and stay first: the e2e
   * suite asserts on Ada Lovelace being the top row.
   */
  public rows(): ShowcaseMember[] {
    const names = [
      "Ada Lovelace",
      "Alan Turing",
      "Grace Hopper",
      "Edsger Dijkstra",
      "Barbara Liskov",
      "Donald Knuth",
      "Margaret Hamilton",
      "Ken Thompson",
      "Frances Allen",
      "Dennis Ritchie",
      "Radia Perlman",
      "Leslie Lamport",
      "Karen Sparck Jones",
      "Tony Hoare",
      "Jean Bartik",
      "Niklaus Wirth",
      "Adele Goldberg",
      "John McCarthy",
      "Sophie Wilson",
      "Robin Milner",
      "Carol Shaw",
      "Peter Naur",
      "Lynn Conway",
      "Vint Cerf",
      "Barbara Grosz",
      "Shafi Goldwasser",
      "Silvio Micali",
      "Manuel Blum",
      "Andrew Yao",
      "Judea Pearl",
      "Michael Stonebraker",
      "Jim Gray",
      "Butler Lampson",
      "Alan Kay",
      "Ivan Sutherland",
      "Douglas Engelbart",
      "Fernando Corbato",
      "Charles Bachman",
      "Edgar Codd",
      "John Backus",
      "Kristen Nygaard",
      "Ole-Johan Dahl",
      "Barbara Simons",
      "Fran Berman",
      "Anita Borg",
      "Jean Sammet",
      "Kathleen Booth",
      "Mary Allen Wilkes",
      "Evelyn Boyd Granville",
      "Annie Easley",
      "Dorothy Vaughan",
      "Katherine Johnson",
      "Mary Jackson",
      "Erna Hoover",
      "Susan Kare",
      "Elizabeth Feinler",
      "Sandra Lerner",
      "Whitfield Diffie",
      "Martin Hellman",
      "Ralph Merkle",
      "Ron Rivest",
      "Adi Shamir",
      "Leonard Adleman",
      "Peter Shor",
      "Cynthia Dwork",
      "Nancy Lynch",
      "Maurice Wilkes",
      "David Wheeler",
      "Christopher Strachey",
      "Peter Landin",
      "John Hopcroft",
      "Robert Tarjan",
      "Stephen Cook",
      "Richard Karp",
      "Michael Rabin",
    ];
    const teams = ["Platform", "Design", "Growth", "Security"];
    // ⚠️ Nine entries against four teams, and the lengths must stay coprime.
    // Both were four once, so `i % 4` picked the team AND the role: every
    // Design member was an Admin, every Platform member an Owner, and
    // filtering by one quietly filtered by the other. Coprime lengths make
    // every team/role pair occur, and the repeats weight the mix the way a
    // real organisation looks - a few owners, mostly members.
    //
    // Keep it off 5 and 7 as well: `status` below is keyed on those.
    const roles = [
      "Owner",
      "Member",
      "Admin",
      "Viewer",
      "Member",
      "Member",
      "Admin",
      "Viewer",
      "Member",
    ];

    const tags = ["remote", "on-call", "mentor", "contractor", "beta"];

    return names.map((name, i) => ({
      id: `mbr_${String(i + 1).padStart(3, "0")}`,
      name,
      email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@alepha.dev`,
      team: teams[i % teams.length],
      role: roles[i % roles.length],
      // Each tag decided by its own two bits of a scrambled row number: one
      // chance in four apiece, so about a third of members carry none, most
      // carry one or two, and "all of remote and mentor" still finds a few.
      // No tag tracks the team, the role or the status - any modulus would
      // line up with one of those, see the roles comment for what that did.
      tags: tags.filter(
        (_, j) => ((Math.imul(i + 1, 2654435761) >>> (j * 3 + 7)) & 3) === 0,
      ),
      status: i % 7 === 0 ? "invited" : i % 5 === 0 ? "disabled" : "active",
      // Fixed epoch, stepped per row. `Date.now()` is banned repo-wide and
      // would also make the prerendered output differ on every build.
      createdAt: new Date(Date.UTC(2026, 0, 1 + i, 9, 30)).toISOString(),
    }));
  }
}

export type ShowcaseMember = Infer<typeof showcaseMemberSchema>;

export type ShowcaseMemberQuery = Infer<typeof showcaseMemberQuerySchema>;
