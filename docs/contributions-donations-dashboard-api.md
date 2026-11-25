# Contributions and donations API: dashboard

The backend calls membership contributions **dues**. Dues and donations are
stored as payments; filter them using `type=dues` or `type=donation`.

Use your backend's base URL with the paths below. All endpoints here require a
Supabase access token:

```http
Authorization: Bearer <access_token>
```

## List all payments

```http
GET /transactions/all?type=dues&month=11&year=2026
```

Requires a profile with `role = "admin"`. All query parameters are optional:

| Parameter | Meaning |
| --- | --- |
| `type` | `dues` or `donation` |
| `month` | Month number, 1–12 |
| `year` | Four-digit year |

Omit `type` to get both dues and donations. Results are ordered by `created_at`
descending and are not paginated. Example response (payment fields shown are
an excerpt):

```json
{
  "success": true,
  "data": [
    {
      "id": "payment-id",
      "user_id": "member-id",
      "type": "dues",
      "month": 11,
      "year": 2026,
      "amount": 10,
      "currency": "EUR",
      "method": "card",
      "status": "completed",
      "label": "November Dues 2026",
      "created_at": "2026-11-01T10:00:00Z",
      "profiles": {
        "id": "member-id",
        "name": "Member Name",
        "email": "member@example.com",
        "region": "Lille"
      }
    }
  ]
}
```

For donations, use `GET /transactions/all?type=donation`. Amounts are in
euros, not cents. A dues payment covering multiple months creates a separate
payment row for each recorded month.

## Dashboard integration notes

- The current contributions page uses mock data, not this endpoint.
- There is no dedicated endpoint here for outstanding dues, overdue members,
  collection rates, charts, or aggregated totals. Payment rows alone do not
  identify members who have not paid.
- `GET /transactions/:id` only retrieves a payment belonging to the signed-in
  user, even for an admin; it is not an admin payment-detail endpoint.
- `/finance` manages separate organization finance records, not this payment
  list. Creating a finance record does not create a dues or donation payment.

## Errors

Errors use `{ "success": false, "error": { "message": "...", "code": "..." } }`.
Common responses are `401` for missing or invalid authentication and `403` for
a non-admin accessing `/transactions/all`.
