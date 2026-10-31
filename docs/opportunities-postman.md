# Postman collection: Opportunities

Build this collection once, then share it with the mobile and dashboard developers.
The request order matches [opportunities.http](opportunities.http). The field-by-field
contract is in [opportunities-api.md](opportunities-api.md).

Publishing (request 4) sends a real push notification to every member. Run it
against a local or test server, or skip that request against production.

## 1. Collection

Create a collection named **GHAFRA — Opportunities**.

**Variables** (Collection → Variables):

| Variable | Initial value | Current value |
|---|---|---|
| `baseUrl` | `http://localhost:5000` | same |
| `adminToken` | empty | a Supabase access token for a user whose `profiles.role` is `admin` |
| `memberToken` | empty | a Supabase access token for a normal member |
| `opportunityId` | empty | leave empty; request 1 fills it |

Do **not** set collection-level Authorization. Admin and member requests use
different tokens, so each request sets its own header:

```
Authorization: Bearer {{adminToken}}
```

or `{{memberToken}}`. Postman sends the header as written; no extra "Bearer" prefix.

Start the API with `npm run dev` before sending anything.

## 2. Folders

| Folder | Who | What it shows |
|---|---|---|
| `01 Walkthrough` | both | The lifecycle, in order. Run top to bottom. |
| `02 Member` | mobile | List filters and the responses a member can get. |
| `03 Admin` | dashboard | Create variants, list filters, and the errors an admin can get. |

Requests below are written as `METHOD {{baseUrl}}/path`. Body is raw JSON.
Every request except the "no token" ones needs the Authorization header named
in that request.

## 3. Walkthrough

Run these in order. Later requests use `{{opportunityId}}` from request 1.

### 1. Admin creates a draft

`POST {{baseUrl}}/opportunities/admin` — `{{adminToken}}`

```json
{
  "title": "Junior Backend Developer",
  "organization": "Acme Lille",
  "type": "job",
  "description": "Build and maintain APIs for our logistics platform.",
  "qualifications": ["Bachelor in Computer Science"],
  "skills": ["TypeScript", "PostgreSQL"],
  "location": "Lille, France",
  "application_deadline": "2030-12-31",
  "application_method": "url",
  "application_url": "https://acme.example/jobs/42"
}
```

**Tests** tab (this is what stores the id for the rest of the collection):

```javascript
const body = pm.response.json();

pm.test("201 draft created", () => {
  pm.response.to.have.status(201);
  pm.expect(body.success).to.eql(true);
  pm.expect(body.data.status).to.eql("draft");
  pm.expect(body.data.availability).to.eql("draft");
});

pm.collectionVariables.set("opportunityId", body.data.id);
```

Expect `201`. `status` is always `draft` on create. The client cannot send `status`.

To attach a pasted image instead of a file, add `"image_url": "https://cdn.example/cover.jpg"` to this JSON. Do not also attach a file.

### 1b. Admin creates a draft with an uploaded image

Same URL and token. Body type **form-data**, not raw JSON:

| Key | Type | Value |
|---|---|---|
| `data` | Text | The JSON from request 1, with no `image_url` |
| `image` | File | A JPEG, PNG, or WebP of 5 MB or less |

Expect `201`. `data.image_url` is a public Supabase URL. Open it in a browser to confirm the dashboard and the app can show it with no token. The Tests script from request 1 still applies, so copy it onto this request too.

Sending both `image` and `image_url` inside `data` returns `422`.

### 2. Member cannot see the draft

`GET {{baseUrl}}/opportunities/{{opportunityId}}` — `{{memberToken}}`

No body. Expect `404`, `error.code` = `NOT_FOUND`. Drafts look the same as
missing listings to members.

### 3. Member cannot use admin endpoints

`GET {{baseUrl}}/opportunities/admin` — `{{memberToken}}`

Expect `403`, `error.code` = `FORBIDDEN`.

### 4. Admin publishes

`POST {{baseUrl}}/opportunities/admin/{{opportunityId}}/publish` — `{{adminToken}}`

No body. Expect `200`. `status` is `published`, `availability` is `open`, and
`published_at` is set. This is the only request that pushes a notification,
and only the first time.

### 5. Member lists open opportunities

`GET {{baseUrl}}/opportunities?type=job&location=lille` — `{{memberToken}}`

Expect `200`. `data` is an array, `meta` has `total`, `page`, `limit`, `pages`.
The listing from step 4 is in `data`. Every item has `availability: "open"`.

### 6. Member opens the listing

`GET {{baseUrl}}/opportunities/{{opportunityId}}` — `{{memberToken}}`

Expect `200`, `data.availability` = `open`, `data.is_expired` = `false`.
Member payloads do not include `created_by`, `updated_by`, or `archived_at`.

### 7. Admin edits a field

`PATCH {{baseUrl}}/opportunities/admin/{{opportunityId}}` — `{{adminToken}}`

```json
{ "title": "Backend Developer (Junior)" }
```

Expect `200` and the new title. Send only the fields that change. `status`
is not accepted here.

### 8. Admin closes it

`POST {{baseUrl}}/opportunities/admin/{{opportunityId}}/close` — `{{adminToken}}`

No body. Expect `200`, `status` = `closed`, `availability` = `closed`,
`closed_at` set.

### 9. Member opens the closed listing

`GET {{baseUrl}}/opportunities/{{opportunityId}}` — `{{memberToken}}`

Expect `410`, `error.code` = `OPPORTUNITY_UNAVAILABLE`. The app should show
"this opportunity is no longer accepting applications" (also used when an old
push notification is opened).

### 10. Admin lists everything

`GET {{baseUrl}}/opportunities/admin?sort_by=application_deadline&sort_order=asc` — `{{adminToken}}`

Expect `200`. Unlike the member list, this includes drafts, closed, expired,
and archived rows. Each row has `availability` and a `creator` object
(`id`, `name`, `email`).

### 11. Admin archives it

`POST {{baseUrl}}/opportunities/admin/{{opportunityId}}/archive` — `{{adminToken}}`

No body. Expect `200`, `status` = `archived`, `availability` = `archived`.
This is final. There is no delete.

### 12. Editing an archived listing fails

`PATCH {{baseUrl}}/opportunities/admin/{{opportunityId}}` — `{{adminToken}}`

```json
{ "title": "Too late" }
```

Expect `409`, `error.code` = `OPPORTUNITY_ARCHIVED`.

## 4. Member folder

Same token on every request: `{{memberToken}}`.

| Name | Request | Expect |
|---|---|---|
| List, defaults | `GET /opportunities` | `200`, `meta.page` 1, `meta.limit` 20 |
| Filter by type | `GET /opportunities?type=internship` | `200`, every item `type` = `internship` |
| Search | `GET /opportunities?search=acme` | `200`, matches title or organization |
| Bad type | `GET /opportunities?type=freelance` | `422`, `error.code` = `VALIDATION_ERROR`, `issues[0].field` = `type` |
| Bad id | `GET /opportunities/not-a-uuid` | `422` |
| No token | `GET /opportunities` with the Authorization header removed | `401`, `error.code` = `UNAUTHORIZED` |

Query params to show in the Params tab, all optional: `page`, `limit` (max 50),
`type` (`job` or `internship`), `location`, `search`.

## 5. Admin folder

Same token on every request: `{{adminToken}}`. These are extra examples, not
part of the ordered walkthrough, so they create their own drafts.

### Create with email applications

`POST /opportunities/admin`

```json
{
  "title": "Data Analyst Intern",
  "organization": "Ghana Embassy Paris",
  "type": "internship",
  "description": "Six-month internship supporting the economic affairs team.",
  "location": "Paris, France",
  "application_method": "email",
  "application_email": "careers@embassy.example"
}
```

Expect `201`. `application_method` decides which detail field is required:
`url` needs `application_url`, `email` needs `application_email`, `other`
needs `application_instructions`.

### Create missing the matching detail

Same body as above, but `application_method` = `"url"` and no `application_url`.

Expect `422`. `error.issues` contains `{ "field": "application_url", ... }`.

### Create with a client-supplied status

Add `"status": "published"` to a valid body. Expect `422`. Status only changes
through publish, close, and archive.

### List filters

`GET /opportunities/admin` with Params:

| Param | Example | Effect |
|---|---|---|
| `status` | `draft` | Only that status |
| `expired` | `true` | Published and past the deadline |
| `type` | `job` | |
| `search` | `acme` | Title or organization |
| `sort_by` | `application_deadline` | Also `created_at`, `updated_at`, `published_at`, `title` |
| `sort_order` | `asc` | `asc` or `desc` |

### Close a draft

`POST /opportunities/admin/{{opportunityId}}/close` while the saved listing is
still a draft (run it before request 4 of the walkthrough, or create a fresh
draft first). Expect `409`, `error.code` = `INVALID_STATUS_TRANSITION`.

### Publish with a past deadline

`PATCH` the draft with `{ "application_deadline": "2020-01-01" }`, then
`POST .../publish`. Expect `422`, `error.code` = `DEADLINE_PASSED`.

## 6. What to tell the frontend

- Every success body is `{ success: true, data }` or, for lists, `{ success: true, data, meta }`.
- Every error body is `{ success: false, error: { message, code, issues? } }`. `issues` only appears on `422`.
- Members only ever receive listings with `availability: "open"`. Use `availability` instead of combining `status` and `application_deadline`.
- `410` means the listing existed and is now closed or expired. `404` means it is missing, still a draft, or archived.
- `application_deadline` is `YYYY-MM-DD` or `null`. The deadline day itself is still open (Europe/Paris).
- A push on first publish carries `data.type = "opportunity"` and `data.opportunity_id`. Open it with `GET /opportunities/:id` and handle `410`.
