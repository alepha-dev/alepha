# The Cloudflare token

To deploy to a Cloudflare account, Lore needs an API token that you create at
Cloudflare and paste into the form that adds a Cloudflare
[host](/lore/docs/apps-hosts), beside the account id. This page says which
token to create.

## What to create

A **Custom token** with these six permissions, limited to the one account the
host deploys to:

| Permission             | Access | What it is for                                             |
| ---------------------- | ------ | ---------------------------------------------------------- |
| **Account Settings**   | Read   | Proving the token can see the account you named.           |
| **Workers Scripts**    | Edit   | Uploading the Worker, and attaching it to a custom domain. |
| **D1**                 | Edit   | The database, when the app has one.                        |
| **Workers KV Storage** | Edit   | Key-value namespaces.                                      |
| **Workers R2 Storage** | Edit   | Object storage, for uploads and artifacts.                 |
| **Queues**             | Edit   | Background jobs.                                           |

All six are required: Lore refuses a token that is missing any of them. All
six are **Account** permissions, and there are no Zone rows to add.

A copy that runs on **Postgres** (its `DATABASE_URL` names a Postgres server)
also needs **Hyperdrive**, Edit. Lore does not check it when you save, since
most copies never use it: without it, the deploy stops at its Hyperdrive
step with Cloudflare's "Authentication error". Add it to the token at
Cloudflare; the host needs no change.

The quickest way:

1. Open Cloudflare's token form with the six permissions already added:
   [Open the Custom token form with the six permissions added](https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_r2%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22queues%22%2C%22type%22%3A%22edit%22%7D%5D&accountId=*&zoneId=all&name=lore-deploy).
   Lore shows the same link under the token field, as **Mint one with the
   right permissions**.
2. Under **Account Resources**, choose **Include** and pick the one account
   this host names.
3. **Continue to summary**, then **Create Token**.
4. Copy the token. Cloudflare shows it once.
5. Back in Lore, paste it into **Cloudflare API token**, with the
   [account id](#the-account-id) in **Cloudflare account id**.

⚠️ **The link does not choose the account for you.** It opens on **All
accounts**. Narrow **Account Resources** to the one account before you create
the token: a deploy token should reach the account it deploys to and no other.

⚠️ **Do not start from the "Edit Cloudflare Workers" template.** It is the one
most people reach for, and it is wrong in both directions. It covers **four**
of the six (Account Settings, Workers Scripts, KV and R2) and misses **D1 and
Queues**, so Lore refuses a token made from it. It also grants **nine things a
Lore deploy never uses**: Cloudflare Pages, Containers, Workers Observability,
Workers Builds Configuration, Workers Agents Configuration, Workers Tail, User
Details, Memberships, and a Zone-level Workers Routes.

⚠️ **Edit and Write are the same permission.** Cloudflare's dashboard says
**Edit** where its API documentation says **Write**. This page uses the
dashboard's wording, because that is the screen you are looking at.

## The account id

On the Cloudflare dashboard's account overview page, in the right-hand column,
labelled **Account ID**. It is 32 hexadecimal characters.

A token that is valid but cannot read the account you named gets a message of
its own, which names both causes: a wrong account id, or a token without
Account Settings. Check the id you pasted first.

## Creating the token by hand

For anyone who would rather see each step, or whose dashboard ignores the
prefilled link:

1. Open the Cloudflare dashboard and click your **profile icon**, top right.
2. **API Tokens**.
3. **Create Token**.
4. Scroll past the templates to **Custom token** and click **Get started**.
5. Give it a name you will recognise in six months, such as `lore-deploy`.
6. Add the six permissions from the table above.
7. Under **Account Resources**, choose **Include** and pick the one account
   this host will name, not "All accounts".
8. **TTL** and **Client IP Address Filtering** are optional. If you set an
   expiry, Lore shows it on the host and checks the token again every night,
   so you find out it lapsed before a deploy does.
9. **Continue to summary**, then **Create Token**.
10. Copy the token. Cloudflare shows it once.

## A token for a team account

Cloudflare issues two kinds of token, and Lore accepts both:

| Kind                    | Prefix  | When                                                                                               |
| ----------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| **User token**          | `cfut_` | A personal Cloudflare account, or an account only you administer.                                  |
| **Account-owned token** | `cfat_` | A team account. It belongs to the account rather than to you, so it survives you leaving the team. |

Older tokens are 40 characters with no prefix at all. Those still work.

The steps above create a user token. For a shared account, prefer the
account-owned kind: it keeps working when the person who set it up has left.
It takes the same six permissions, from a different starting point:

1. In the dashboard, select the **account**, then **Manage Account**.
2. **Account API Tokens**.
3. **Create Token**, then **Custom token**.
4. Continue from step 5 of the list above.

Or open the form with the permissions already added:

[Open the account-owned Custom token form with the six permissions added](https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=%5B%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_r2%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22queues%22%2C%22type%22%3A%22edit%22%7D%5D&name=lore-deploy)

That link names no account: the dashboard works out which one, so check the
account on the form here too.

Creating an account-owned token needs **Super Administrator** on that account.
Without it the **Create Token** button is not there: ask whoever administers
the account.

## When you save

Lore checks the token with Cloudflare before it saves anything, and the dialog
says **Checking with Cloudflare…** meanwhile.

- **Every check passes.** The host is created, lent to the project, and
  ready to deploy to.
- **One fails.** The message names the missing permission, in Cloudflare's own
  words, beside the field it concerns. Nothing is saved, so there is no
  half-made host to repair: fix the token, or create a better one, and try
  again.
- **Cloudflare cannot be reached.** Lore says so and saves nothing. It does
  not mark the token as invalid: an outage says nothing about your token.

| What Lore says                                                                                                                                 | What to do                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Cloudflare did not accept this token                                                                                                           | Cloudflare does not recognise it. Paste it again: a cut-off paste does this. |
| This Cloudflare token has expired                                                                                                              | Its TTL has passed. Create a new one.                                        |
| This Cloudflare token is disabled; enable it at Cloudflare or mint a new one                                                                   | It was revoked or switched off at Cloudflare.                                |
| This Cloudflare token is not valid before _date_                                                                                               | Its start date is still in the future.                                       |
| Lore could not read Cloudflare account _id_ with this token. Either the account id is wrong, or the token is missing "Account Settings: Read". | Check the account id first, then the permission.                             |
| This token cannot reach Workers on this account. Add "Workers Scripts: Edit" to it and try again.                                              | Add **Workers Scripts**, Edit.                                               |
| This token cannot reach D1 on this account. Add "D1: Edit" to it and try again.                                                                | Add **D1**, Edit.                                                            |
| This token cannot reach Workers KV on this account. Add "Workers KV Storage: Edit" to it and try again.                                        | Add **Workers KV Storage**, Edit.                                            |
| This token cannot reach Workers R2 on this account. Add "Workers R2 Storage: Edit" to it and try again.                                        | Add **Workers R2 Storage**, Edit.                                            |
| This token cannot reach Queues on this account. Add "Queues: Edit" to it and try again.                                                        | Add **Queues**, Edit.                                                        |
| Cloudflare could not be reached, try again                                                                                                     | Try again. Nothing was recorded either way.                                  |

### What the check cannot see

The check proves the token can **read** each of the six, not that it can
edit. A token given Read where the table asks for Edit passes here and fails at
the first deploy.

⚠️ **The check cannot tell whether the account has a workers.dev subdomain.**
A deploy asks for one when the app is published there, and an account that has
never registered one answers with an error that looks exactly like a missing
permission. The failure arrives at deploy time, naming the account and not the
token. Register a workers.dev subdomain in the Cloudflare dashboard, or deploy
to a custom domain only.

## What Lore stores

The token is **encrypted at rest**. What Lore shows of it is its prefix plus
eight characters (`cfut_a1B2c3D4`), or the first eight for an older token with
no prefix: enough to tell two tokens apart, and far too few to rebuild one.

⚠️ **Lore never shows the token back, not even right after you save it.** This
differs from a Bay host, whose secret Lore creates and shows once. Here you
brought the token and already have it. The only way to change it is **Replace
token**, in the host's drawer, and nothing is revealed after that either.

## The nightly check

Once a night Lore asks Cloudflare again about every Cloudflare host. If a
token has stopped passing, the host shows as **credential invalid** with the
reason, deploys to it are refused until the token is replaced, and every
member of its home project whose rank grants `host:update` gets one email.
So a token revoked or narrowed at Cloudflare is reported within a day, not by
the first deploy that fails.

**Check again**, in the host's drawer, does the same thing on demand, which
is what you want right after widening a token at Cloudflare.

## Deleting a host does not revoke the token

⚠️ Deleting the host removes Lore's copy of the token, and the projects the
host was lent to lose a place to deploy. The token itself goes on existing
and working, for anything else that holds it. To revoke it, go back to where
you created it, **API Tokens** for a user token or **Account API Tokens** for
an account-owned one, and delete it there.

## Next

- [Hosts](/lore/docs/apps-hosts): lending the host to other projects,
  who can manage it, deleting it.
- [Deploying an app](/lore/docs/apps-deploying): pick the host and ship a
  build.
- [Notifications](/lore/docs/project-notifications): how the email about a
  failing token reaches you.
