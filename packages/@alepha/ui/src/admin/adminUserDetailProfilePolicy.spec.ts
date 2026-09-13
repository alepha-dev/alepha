import { describe, expect, it } from "vitest";

import {
  profileIssues,
  profilePolicy,
  profileUpdateBody,
} from "./admin-user-detail-profile-policy.ts";

/**
 * A realm that signs users in by username only: no email is ever collected,
 * so every user row has an empty one.
 */
const usernameOnly = { username: "required", email: "none" } as const;

/**
 * The framework default: email-based accounts, no username at all.
 */
const emailOnly = { username: "none", email: "required" } as const;

describe("profilePolicy", () => {
  it("hides a field the realm does not collect", () => {
    const policy = profilePolicy(usernameOnly, { username: "neo" });
    expect(policy.email).toEqual({ visible: false, required: false });
    expect(policy.username).toEqual({ visible: true, required: true });
  });

  it("still shows a field the realm dropped when the user carries a value", () => {
    const policy = profilePolicy(usernameOnly, {
      username: "neo",
      email: "neo@example.com",
    });
    expect(policy.email).toEqual({ visible: true, required: false });
  });

  it("treats an unreadable realm config as optional, never required", () => {
    const policy = profilePolicy(undefined, {});
    expect(policy.username).toEqual({ visible: true, required: false });
    expect(policy.email).toEqual({ visible: true, required: false });
  });

  it("does not require a username the realm derives from the email", () => {
    const policy = profilePolicy({ username: "email", email: "required" }, {});
    expect(policy.username).toEqual({ visible: true, required: false });
  });
});

describe("profileIssues", () => {
  it("accepts an empty email on a username-only realm", () => {
    const policy = profilePolicy(usernameOnly, { username: "neo" });
    const issues = profileIssues(
      { username: "neo", email: "", roles: ["user", "admin"] },
      policy,
      { username: "neo" },
    );
    expect(issues).toEqual([]);
  });

  it("reports a missing email when the realm requires one", () => {
    const policy = profilePolicy(emailOnly, { email: "neo@example.com" });
    const issues = profileIssues({ email: "" }, policy, {
      email: "neo@example.com",
    });
    expect(issues).toEqual([{ field: "email", reason: "required" }]);
  });

  it("refuses to blank a value that cannot be unset", () => {
    const policy = profilePolicy(
      { username: "optional", email: "optional" },
      { username: "neo", email: "neo@example.com" },
    );
    const issues = profileIssues({ username: "neo", email: "" }, policy, {
      username: "neo",
      email: "neo@example.com",
    });
    expect(issues).toEqual([{ field: "email", reason: "cannot-clear" }]);
  });

  it("says nothing about a field that was already empty", () => {
    const policy = profilePolicy(
      { username: "optional", email: "optional" },
      {
        username: "neo",
      },
    );
    const issues = profileIssues({ username: "neo", email: "" }, policy, {
      username: "neo",
    });
    expect(issues).toEqual([]);
  });
});

describe("profileUpdateBody", () => {
  it("omits the email entirely on a username-only realm", () => {
    const user = { username: "neo" };
    const policy = profilePolicy(usernameOnly, user);
    const body = profileUpdateBody(
      { username: "neo", email: "", roles: ["user", "admin"] },
      policy,
      user,
    );
    // `users` is uniquely indexed on (realm, email) — sending "" writes a
    // value that the next user to be saved collides with.
    expect(body).not.toHaveProperty("email");
    expect(body).not.toHaveProperty("emailVerified");
    expect(body.username).toBe("neo");
    expect(body.roles).toEqual(["user", "admin"]);
  });

  it("keeps the verified flag when the email is unchanged", () => {
    const user = { email: "neo@example.com" };
    const policy = profilePolicy(emailOnly, user);
    const body = profileUpdateBody(
      { email: "neo@example.com", emailVerified: true },
      policy,
      user,
    );
    expect(body.email).toBe("neo@example.com");
    expect(body.emailVerified).toBe(true);
  });

  it("drops the verified flag when the email changes", () => {
    const user = { email: "neo@example.com" };
    const policy = profilePolicy(emailOnly, user);
    const body = profileUpdateBody(
      { email: "trinity@example.com", emailVerified: true },
      policy,
      user,
    );
    expect(body.email).toBe("trinity@example.com");
    expect(body.emailVerified).toBe(false);
  });

  it("trims names and defaults roles to an empty list", () => {
    const policy = profilePolicy(usernameOnly, { username: "neo" });
    const body = profileUpdateBody(
      { username: " neo ", firstName: " Thomas ", lastName: "" },
      policy,
      { username: "neo" },
    );
    expect(body).toEqual({
      username: "neo",
      firstName: "Thomas",
      lastName: "",
      roles: [],
    });
  });
});
