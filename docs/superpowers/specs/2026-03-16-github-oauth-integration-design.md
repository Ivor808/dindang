# GitHub OAuth Integration Design

## Problem

Users must manually paste GitHub tokens into the Credentials settings tab. This is a trust concern — users are reluctant to hand over tokens to a third-party service. The login page already requests the `repo` scope from GitHub OAuth via Supabase, but the resulting `provider_token` is never captured.

## Solution

Capture the GitHub OAuth token automatically during the auth callback, and provide a "Connect GitHub" button for users who signed in via Google or email/password.

## Approach

Use Supabase's existing OAuth flow (Approach A). No new infrastructure — reuses `userCredentials` table, encryption, and Supabase OAuth.

## Design

### 1. Auth Callback Token Capture (`auth.callback.tsx`)

When the `SIGNED_IN` event fires in the callback:

1. Get the current session via `supabase.auth.getSession()`
2. Check if `session.provider_token` exists
3. If so, call a server function `saveProviderToken({ provider: 'github', token })` to encrypt and upsert into `userCredentials`
4. Navigate to `/` as before

The `provider_token` is only available once (at callback time), so it must be captured here.

### 2. Server Function (`server/settings.ts`)

Add `saveProviderToken` — identical to `saveCredential` but designed for the callback context. Reuses `deriveKey` + `encrypt` + upsert into `userCredentials`.

This could be the same `saveCredential` function, but having a distinct name makes intent clearer and allows future divergence (e.g. storing token metadata).

### 3. Credentials Tab UI (`settings.tsx`)

Replace the GitHub token text input with:

- **If `hasGithub` is true**: Show "Connected via GitHub" with a green status indicator and a "Reconnect" button
- **If `hasGithub` is false**: Show a "Connect GitHub" button that triggers `supabase.auth.linkIdentity({ provider: 'github', scopes: 'repo', redirectTo: '/auth/callback' })`
- Remove the manual token paste input for GitHub entirely

Keep the Anthropic API key input as-is (no OAuth alternative for that).

### 4. Auth Callback — Handling Link vs Login

The callback already listens for `SIGNED_IN`. Supabase also fires this event when linking an identity. The token capture logic works the same for both cases — no branching needed.

### 5. Credential Status Enhancement (`server/settings.ts`)

Extend `getCredentialStatus` to also return `githubLogin: boolean` — whether the user has a GitHub identity linked in Supabase. This lets the UI distinguish between "connected via OAuth" and "token pasted manually" if needed in the future. For now, `hasGithub` is sufficient.

Actually, this is unnecessary for v1. Just `hasGithub` is enough.

## Files Changed

| File | Change |
|------|--------|
| `src/routes/auth.callback.tsx` | Capture `provider_token` from session, call `saveProviderToken` |
| `src/server/settings.ts` | Add `saveProviderToken` server function |
| `src/routes/settings.tsx` | Replace GitHub token input with "Connect GitHub" button / "Connected" status |

## Testing

- GitHub login flow: verify token is auto-captured and `hasGithub` becomes true
- Google/email user: verify "Connect GitHub" button triggers OAuth and token is captured on return
- Reconnect: verify existing token is replaced when re-linking
- Agent creation: verify agents can still clone private repos with the OAuth-captured token

## Edge Cases

- **`provider_token` is null**: Can happen if the OAuth didn't include GitHub (e.g. Google login). The callback simply skips saving — no error.
- **Token expired/revoked**: GitHub OAuth tokens from Supabase are long-lived. If a user revokes access on GitHub, agent creation will fail with a git auth error. The "Reconnect" button handles this.
- **Supabase `linkIdentity` email mismatch**: If the user's GitHub email doesn't match their Supabase account email, Supabase may create a new account instead of linking. This is a Supabase config issue (enable "Auto-confirm users" or email matching). Out of scope for this change.
