<!--
add-audit-event.md — vendor-neutral skill for emitting an audit event
from any mutation endpoint.

The audit log is the most important operational tool after the database
itself. Every admin mutation MUST emit an event. This skill covers the
conventions.
-->

# Skill: Add an audit event

## Pre-flight

1. Read `lib/admin/audit.ts` end-to-end — that's the function you'll call.
2. Read `supabase/migrations/0006_admin_panel.sql` (table definition)
   and `0007_rls_admin.sql` (the policies — note that `authenticated`
   has SELECT but no INSERT).
3. Read `docs/RBAC.md` § "Audit log policy" for event_type naming conventions.

## Output

You do NOT create a new file. You add a single `recordAuditEvent()`
call to an existing route handler, immediately after the mutation
succeeds and before returning `ok(...)`.

## The call

```ts
import { recordAuditEvent, extractRequestMeta } from "@/lib/admin/audit";

const meta = extractRequestMeta(request);
await recordAuditEvent({
  actor: ctx.user,
  companyId: ctx.company.id,             // or null for platform-level
  workspaceId: data.workspace_id,         // optional, or null
  eventType: "member.role_changed",
  payload: {
    target_user_id: target.user_id,
    old_role: target.role,
    new_role: body.role,
  },
  ...meta,
});
```

### Field rules

- **`actor`** — `ctx.user` from the ActiveContext. **Always required**
  except for system-triggered events (which we don't have yet — see
  below).
- **`companyId`** — The company this event is scoped to. Pass `null` for
  truly platform-level events (cross-tenant operations like creating
  a new company from a super_admin form).
- **`workspaceId`** — If the action affects a specific workspace.
  Optional. Most company-level events don't have one.
- **`eventType`** — `lower_snake_case.dot.notation`. Standard verbs:
  `created`, `updated`, `deleted`, `archived`, `unarchived`, `invited`,
  `removed`, `suspended`, `unsuspended`, `promoted_to_*`, `demoted_from_*`,
  `role_changed`, `settings_updated`.
- **`payload`** — JSON object. Keep it SMALL — IDs and diffs, not full
  entity payloads. Operators can join on `actor_user_id` or
  `target_user_id` if they need more context.

## Event type registry

These are the types in use. Add new ones following the same pattern.

### Company-level

- `company.suspended`, `company.unsuspended`
- `company.settings_updated`

### Workspace-level

- `workspace.created`, `workspace.archived`, `workspace.unarchived`

### Member-level

- `member.invited`, `member.role_changed`, `member.removed`

### User-level (super_admin)

- `user.promoted_to_super_admin`, `user.demoted_from_super_admin`

### Future (not yet emitted)

- `company.created` — when a self-service onboarding flow is added.
- `audit.exported` — when admin exports the log.

## Why JSONB payload (not columns)

Because:

1. Event types evolve faster than columns.
2. Different events want different keys. `member.role_changed` wants
   `{target_user_id, old_role, new_role}`; `company.suspended` wants
   `{previous, next}`. A schema with all columns would have 80%
   nulls.
3. Operators can filter with PostgREST: `payload->>'event_specific_key'`.
4. The audit_events table is append-only, so denormalizing into
   columns isn't a write-time cost.

## Anti-patterns

- ❌ **Auditing before the mutation succeeds.** If the mutation fails,
  you've recorded a phantom event. Always audit AFTER the DB write.
- ❌ **Throwing from `recordAuditEvent()`.** It never throws — it logs
  the failure and returns false. If auditing matters to you, check the
  return value and... actually, just don't. Audit failures shouldn't
  block the user's primary action.
- ❌ **PII in the payload.** Don't include emails, full names, or any
  other user data. IDs only — operators can join to profiles if they
  need the display name.
- ❌ **Including the request body.** Especially not passwords or
  tokens. Just the diff (old vs new).
- ❌ **Big JSON.** If your payload is more than ~200 bytes, you're
  probably storing the wrong thing. The audit log is for incident
  investigation, not state reconstruction.

## VERIFY

After adding the call:

- [ ] `pnpm typecheck` clean.
- [ ] Sign in as super_admin → perform the mutation → `/admin/api/audit`
      shows the new event with the correct `event_type` and `payload`.
- [ ] Sign in as a company admin → perform their mutation →
      `/admin/api/audit?company_id=<their_company>` shows it. (RLS will
      hide events from other companies.)
- [ ] The actor_user_id matches the caller's JWT `sub`.
- [ ] The event_type follows `lower_snake_case.dot.notation`.

## When NOT to add an audit event

- **Read-only endpoints.** No mutation, no audit.
- **Failed mutations.** Don't audit what didn't happen.
- **User self-service actions** like "update my profile" or "change my
  password". Those go in auth.audit_log (Supabase built-in) or a
  separate `user_actions` table if you need a custom log.
- **Background jobs.** They have no human actor. Use `actor_user_id =
  null` and a clear `event_type` prefix like `system.*`.

## Reading the audit log

For ad-hoc investigation, hit the API:

```bash
# Everything in the last hour, across all companies
curl -s -H "Cookie: <your-session>" \
  "http://localhost:3000/admin/api/audit?since=2026-07-14T00:00:00Z"

# Just member changes in company X
curl -s -H "Cookie: <your-session>" \
  "http://localhost:3000/admin/api/audit?company_id=<X>&event_type=member.role_changed"
```

For long-term retention, set up an Edge Function that tails the
`audit_events` table and ships rows to S3 / Datadog / your SIEM.
That's out of scope for the template but a one-day PR.