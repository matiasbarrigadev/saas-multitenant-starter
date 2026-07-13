# Tenancy: Company vs Workspace

When to model something as a Company and when as a Workspace.

## Mental model

| | Company | Workspace |
|---|---|---|
| **URL** | subdomain (`acme.tuapp.com`) | path (`/w/<slug>`) |
| **Use it for** | organization, billing entity, brand | team, project, client engagement |
| **Data isolation** | optional (rarely used) | yes — primary boundary |
| **User membership** | implicit (via workspace membership) | explicit (the membership row) |
| **Wildcard SSL** | yes (one per company setup) | inherited from parent company |
| **Can a user have one but not the other?** | never (every workspace belongs to a company) | yes (a company with zero workspaces is fine) |

## Decision tree

```
Is this a real-world organization with its own brand, billing, contracts?
├── YES → Company
└── NO  → Is this a sub-team or sub-project inside an organization?
         ├── YES → Workspace
         └── NO  → probably not a tenant at all (maybe just a tag or filter)
```

## Examples

- **Linear / Notion**: one company = one org. Workspaces within it. Companies
  are extremely rare outside of true B2B. → Both levels needed.
- **Slack**: workspace = the company. Sub-teams are channels. → Only one level.
- **Vercel**: team = company (they call it a "team"). Personal accounts are
  separate. → Only one level.
- **Consulting agency SaaS** (e.g. a tool for managing client engagements):
  agency = company, each client engagement = workspace. Users belong to
  multiple workspaces (one per client they're staffed on). → Both levels,
  workspace is the data boundary.

## When NOT to use this template's hierarchy

If your product has only one level of tenancy, you're better off skipping
the company level entirely:

- **Single-tenant tools** (e.g. personal dashboards): use Supabase + RLS with
  just `auth.uid()` as the boundary. You don't need companies.
- **B2B SaaS with strict org isolation and no sub-divisions**: use just
  `companies` as the data boundary. Skip `workspaces` entirely.

This template is opinionated about two levels because that's the common
case where the trade-offs are hardest.

## Migrating later

If you start with one level and add another:

- **Adding workspace to a company-only design**: introduce the `workspaces`
  table, add a `workspace_id` column to every tenant-scoped table. Drop the
  old `company_id` column once data is migrated. The RLS pattern from
  `0005_notes_example.sql` applies unchanged.
- **Splitting one company into many**: just create additional companies
  and move data. Nothing in the schema has to change; the subdomain
  resolution becomes the only knob.

In both cases, the auth hook's `company_memberships` shape stays the same.
Adding a level just means adding one more level of nesting in the JWT
claim.

## Cross-tenant safety notes

- A user logged into `acme.tuapp.com` cannot navigate to `globex.tuapp.com`
  without re-authenticating OR getting redirected to the apex (no membership
  in Globex → `proxy.ts` bounces them).
- A user can be a member of the same workspace_id only once (unique
  constraint on `(workspace_id, user_id)`).
- Workspace slugs are unique within a company, not globally. So `marketing`
  can exist in both Acme and Globex. URLs disambiguate via the subdomain.
- A `user_id` cannot appear in `memberships` for a workspace without a
  matching `companies` row — FK constraints enforce this on insert.