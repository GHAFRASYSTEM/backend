# Contributions and donations API: mobile app

The backend calls membership contributions **dues**. Use your backend's base
URL with the paths below. Unless noted otherwise, send a Supabase access token:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

Successful responses use `{ "success": true, "data": ... }`. The mobile app's
`api` helper returns the `data` value directly.

## Pay dues or make a donation

1. Create a payment intent.
2. Use `data.client_secret` to initialize and present the Stripe Payment Sheet.
3. After Stripe reports success, call `/dues/confirm` with the returned intent
   ID and the same `type`. Refresh status and history after confirmation.

### 1. Create a payment intent

```http
POST /dues/create-payment-intent
```

For dues:

```json
{ "type": "dues", "months": 3 }
```

For a donation:

```json
{ "type": "donation", "amount": 20 }
```

| Field | Rules |
| --- | --- |
| `type` | Required: `dues` or `donation` |
| `months` | Dues only; integer 1–12, defaults to 1 |
| `amount` | Donation amount in euros; required for donations, minimum €1; ignored for dues |

Dues cost €5 per month for a profile whose occupation is `student`
(case-insensitive), otherwise €10 per month. The backend chooses the next
unpaid months starting with the current month, skipping already-paid months.
The current month uses the backend's configured timezone.

Example response (`201 Created`):

```json
{
  "success": true,
  "data": {
    "client_secret": "pi_example_secret_example",
    "payment_intent_id": "pi_example",
    "amount": 30,
    "currency": "EUR",
    "label": "Nov 2026 – Jan 2027 Dues (3 months)",
    "type": "dues",
    "months": [
      { "year": 2026, "month": 11 },
      { "year": 2026, "month": 12 },
      { "year": 2027, "month": 1 }
    ]
  }
}
```

For a donation, `months` is an empty array. Use the returned amount and label
for display rather than assuming the amount charged.

### 2. Confirm after Stripe succeeds

```http
POST /dues/confirm
```

```json
{ "payment_intent_id": "pi_example", "type": "dues" }
```

Use `type: "donation"` for a donation intent. A successful response contains
the first recorded payment row and `months_covered`, an array of
`{ "year": ..., "month": ... }` objects. For multi-month dues, a separate row
is recorded for each month. If the payment was already recorded, the response
is:

```json
{ "success": true, "data": { "already_recorded": true } }
```

Confirmation checks that the Stripe intent succeeded and belongs to the
signed-in user. The Stripe webhook logs payment events but does not record
payments, so the app must call `/dues/confirm` after payment.

## Check dues status

```http
GET /dues/status
```

Example response (`payment` abbreviated):

```json
{
  "success": true,
  "data": {
    "paid": true,
    "payment": { "id": "payment-id" },
    "month": 11,
    "year": 2026,
    "label": "November Dues 2026",
    "amount": 10,
    "amount_per_month": 10,
    "currency": "EUR",
    "paid_through": { "year": 2026, "month": 12 },
    "paid_through_label": "December 2026",
    "months_paid_ahead": 1,
    "advance_months": [{ "year": 2026, "month": 12 }],
    "max_advance_months": 12
  }
}
```

`payment` and `paid_through` can be `null`. The current implementation sets
`paid` based on whether a current-month dues row exists; `paid_through` uses
completed dues rows.

## Payment history

| Endpoint | Returns |
| --- | --- |
| `GET /dues/history` | Signed-in user's dues rows, newest year and month first |
| `GET /transactions` | Signed-in user's dues and donations, newest created first |
| `GET /transactions/:id` | One payment belonging to the signed-in user |

`GET /transactions` accepts optional `type=dues` or `type=donation`,
`month` (1–12), and `year` filters, for example:

```http
GET /transactions?type=donation&year=2026
```

The list response is an array in `data` with no pagination. Payment rows include
`id`, `type`, `label`, `amount`, `currency`, `status`, `month`, `year`, and
`created_at`; amounts are in euros.

## Membership verification code

- `GET /dues/my-code` returns `{ "success": true, "data": { "code": "A3F9 B21C" } }`.
  `code` is `null` when the current month's completed dues are not found.
- `GET /dues/verify/:code` is public and returns `data.valid`. A valid result
  also includes `month`, `year`, and `member` (which can be `null`).

## Errors

Errors use `{ "success": false, "error": { "message": "...", "code": "..." } }`.
Common responses: `401` for authentication, `422` for invalid request fields,
`400` for an insufficient donation or an incomplete Stripe payment, `403` for
another user's intent, and `404` for a missing profile or payment. Validation
errors also include `error.issues` with field names and messages.
