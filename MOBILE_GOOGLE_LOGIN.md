# Customer Google sign-in handoff

Google sign-in is for customer accounts created by a web POS employee. It does not register a new customer and does not grant access to a customer record based only on a matching Google email.

## Configuration

- Register the Android app's package name and signing SHA-1 in the same Google Cloud project used for the Web OAuth client. Register production signing separately when the final package name and release key are chosen.
- Set `GOOGLE_MOBILE_SERVER_CLIENT_ID` in the backend environment to the Web OAuth client ID used as the mobile app's `GOOGLE_SERVER_CLIENT_ID`. The backend falls back to `GOOGLE_CLIENT_ID` when the mobile-specific value is absent.
- The backend must be able to fetch Google's public signing keys from `https://www.googleapis.com/oauth2/v3/certs` over HTTPS. No Google client secret is sent to the mobile app.

## First-time link

1. The employee creates the customer in the web POS. This creates a linked customer login with phone and email.
2. The customer signs in with `POST /api/v1/auth/customer/login` using phone and password.
3. The app obtains a Google ID token for the configured Web OAuth client ID.
4. The app calls `POST /api/v1/auth/customer/google/link` with `Authorization: Bearer <TechNova access token>` and JSON body `{ "idToken": "<Google ID token>" }`.
5. A successful link returns `{ "linked": true }`. The Google email must match the customer's TechNova email. A Google account already linked to another user cannot be reassigned.

## Later Google sign-in

Call `POST /api/v1/auth/google/mobile` with JSON body `{ "idToken": "<Google ID token>" }`. On success, the response is:

```json
{
  "data": {
    "user": {
      "id": "...",
      "firstName": "...",
      "lastName": "...",
      "email": "...",
      "phone": "...",
      "customerNumber": "...",
      "mustChangePassword": false
    },
    "tokens": {
      "accessToken": "...",
      "refreshToken": "...",
      "expiresIn": 900
    }
  }
}
```

An unlinked Google account receives HTTP 401. The app should then offer the phone/password login and link flow, not silently create a customer. Staff login remains separate; hide the customer Google button in staff mode.
