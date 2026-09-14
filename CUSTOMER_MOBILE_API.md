# Customer mobile API

All request and response bodies use JSON. Customer endpoints require
`Authorization: Bearer <accessToken>` unless noted otherwise.

## Authentication

### Sign in

`POST /auth/customer/login`

```json
{
  "phone": "+94771234567",
  "password": "the-temporary-or-current-password"
}
```

The phone number must be in international E.164 format. The response contains
`accessToken`, `refreshToken`, `expiresIn`, `user`, and `customer`. If
`user.mustChangePassword` is `true`, the mobile app should take the customer to
its change-password screen before normal use.

### Change the temporary password

`POST /auth/change-password`

```json
{
  "currentPassword": "temporary-password",
  "newPassword": "StrongNewPassword!2026"
}
```

This endpoint requires the current access token. Changing the password revokes
existing refresh sessions, so the app should return to sign in afterward.

### Refresh a session

`POST /auth/customer/refresh`

```json
{
  "refreshToken": "refresh-token-from-login"
}
```

Refresh tokens rotate. Always replace the stored refresh token with the new one
returned by this endpoint.

### Sign out

`POST /auth/customer/logout`

```json
{
  "refreshToken": "current-refresh-token"
}
```

## Customer data

- `GET /customer-app/home` — customer identity and headline counts.
- `GET /customer-app/profile` — profile, company branding, loyalty and store credit.
- `GET /customer-app/loyalty?page=1&pageSize=20` — point balance, tier and point history.
- `GET /customer-app/products?page=1&pageSize=20&search=&categoryId=` — active product catalog, media and branch availability.
- `GET /customer-app/categories` — active categories for product browsing and filters.
- `GET /customer-app/credit-purchases?page=1&pageSize=20` — credit sales, line items and installment schedule.
- `GET /customer-app/promotions?page=1&pageSize=20` — promotions active at request time.
- `GET /customer-app/notifications?page=1&pageSize=20&unread=true` — in-app notifications and unread count.
- `PATCH /customer-app/notifications/:id/read` — mark one notification as read.
- `PATCH /customer-app/notifications/read-all` — mark all notifications as read.

Paginated endpoints return:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 0,
    "pageCount": 0
  }
}
```

Notification responses also include an `unread` count. The product response
does not expose inventory cost prices or internal purchasing data.
