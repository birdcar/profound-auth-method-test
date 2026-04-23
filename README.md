# profound-auth-method-test

A reproducible proof that the WorkOS Node SDK returns `authenticationMethod` on AuthKit login responses, including on `authenticateWithSessionCookie()`.

## Why this exists

The [WorkOS reference docs for `authenticateWithSessionCookie`](https://workos.com/docs/reference/authkit/authentication#authenticate-with-session-cookie) do not list `authenticationMethod` in the response shape. The [Node SDK](https://github.com/workos/workos-node) does return it — specifically on the success branch of the exported `AuthenticateWithSessionCookieSuccessResponse` type, where it is a required field.

This repo is a one-file demo that logs in with AuthKit, then unseals the session cookie locally, and renders both responses side by side so you can see the field with your own eyes. Treat the SDK types as the source of truth; the reference docs page is out of date.

## Prerequisites

- [Bun](https://bun.sh) 1.3 or newer
- A WorkOS account with an AuthKit environment configured
- `http://localhost:3000/callback` added as a redirect URI in the WorkOS dashboard (Applications → Configuration → Redirects). The string must match exactly.

## Setup

```bash
git clone https://github.com/birdcar/profound-auth-method-test.git
cd profound-auth-method-test
bun install
```

Set the following environment variables (via `.env`, shell export, or your runner of choice):

| Variable                 | Required | Notes                                                                                                    |
| ------------------------ | -------- | -------------------------------------------------------------------------------------------------------- |
| `WORKOS_API_KEY`         | yes      | `sk_test_...` or `sk_live_...`, from dashboard → API Keys                                                |
| `WORKOS_CLIENT_ID`       | yes      | `client_...`, from dashboard → Applications                                                              |
| `WORKOS_COOKIE_PASSWORD` | no       | 32+ characters. Auto-generated at boot if unset. Set it explicitly if you want sessions to survive restarts. |
| `PORT`                   | no       | Defaults to `3000`. Changing it means updating your redirect URI too.                                    |

## Run

```bash
bun run authMethodDemo.ts
```

Open [http://localhost:3000](http://localhost:3000) and click "Log in with AuthKit".

## What you should see

After login, the callback page renders two syntax-highlighted JSON blocks:

1. The response from `authenticateWithCode` (an `AuthenticationResponse`).
2. The response from `authenticateWithSessionCookie`, called with the sealed session from step 1 (an `AuthenticateWithSessionCookieSuccessResponse`).

Both blocks contain a line like:

```json
"authenticationMethod": "Password"
```

The value will be `"Password"`, `"SSO"`, `"GoogleOAuth"`, `"Passkey"`, or one of the other variants in the SDK's `AuthenticationMethod` union, depending on how you authenticated. The field is highlighted in both blocks via ExpressiveCode text markers so it is easy to spot.

Access, refresh, and sealed-session tokens are truncated to `abc…xyz` previews in the rendered output, so screenshots are safe to share.

## How it works

The callback handler runs two tests back to back:

1. `workos.userManagement.authenticateWithCode({ code, clientId, session: { sealSession: true, cookiePassword } })` exchanges the authorization code and returns a sealed session.
2. `workos.userManagement.authenticateWithSessionCookie({ sessionData, cookiePassword })` takes that sealed session and unpacks it locally — no round-trip to the WorkOS API.

The same `authenticationMethod` value appears in both responses. That value is pinned to the session at login time, packed into the sealed cookie, and unpacked by the SDK on each verification. That's why it's available on `authenticateWithSessionCookie` without an extra API call.

## Notes and caveats

- This is a proof-of-concept, not production code. It does not set cookies, does not implement CSRF state, does not use PKCE, and holds decrypted tokens in server memory. Do not copy the session handling into a real app.
- The SDK type `AuthenticateWithSessionCookieSuccessResponse` (exported from [`@workos-inc/node`](https://github.com/workos/workos-node)) is the authoritative shape. If you're writing a type-safe integration, import it directly.
- General AuthKit docs: [workos.com/docs/authkit](https://workos.com/docs/authkit).

## License

MIT
