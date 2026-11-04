# Meta app review checklist

What Meta asks for before an app can read other people's messages and comments. Nothing here has been submitted;
this is the list to work through. Verify each item against the current Meta developer dashboard, because Meta
changes its forms and wording.

## 1. Public pages (built)

| Meta field | Value |
|---|---|
| Privacy Policy URL | `https://<web-host>/privacy` |
| Terms of Service URL | `https://<web-host>/terms` |
| User data deletion | instructions URL `https://<web-host>/data-deletion` |

- The pages are public (no sign-in) and name the operator from `VITE_LEGAL_ENTITY_NAME` and
  `VITE_LEGAL_CONTACT_EMAIL`. Use a mailbox someone actually reads: reviewers and users will write to it.
- The text is a draft written from what the code does. Have it reviewed before launch, and add a governing-law
  clause, which it deliberately leaves out. If the product changes what data it keeps or who receives it, update
  the policy and `LEGAL_EFFECTIVE_DATE` in the same commit.
- The pages promise deletion within 30 days of a verified emailed request. Only promise what you can do.

## 2. App settings (manual, in the Meta dashboard)

- App icon (1024x1024), display name, app category, contact email.
- Business Verification of the business that owns the app (needed for Advanced Access).
- Instagram product configured with the callback URL and verify token from `docs/DEPLOYMENT.md`, with the
  `messages` and `comments` webhook fields subscribed.
- OAuth redirect URI registered; the web app and API served over HTTPS with valid certificates.

## 3. Permissions to request

Request only what the code uses (`META_OAUTH_SCOPES`). For each permission Meta wants a written justification, in
product terms, and a screencast. Suggested justifications:

- Messages: the business answers customers' Instagram DMs from one inbox, with an optional AI assistant and human
  takeover.
- Comments: the business sees and replies to comments on its own posts, and can send an opt-in private reply.
- Basic profile: to show which account is connected.

## 4. Screencast and reviewer access

- Record the full flow: sign in, connect Instagram through Meta's consent screen, receive a DM, see it in the
  inbox, send a reply, disconnect, and show the deletion instructions page.
- Give reviewers a working test login and a test Instagram account with a role on the app.
- Keep the app reachable the whole review: an unreachable server is a common reason for rejection.

## 5. Platform rules the product must keep following

- Replies only to people who messaged first and inside Meta's messaging window; private replies to comments only
  within Meta's allowed period.
- No sale of platform data; use it only to serve the business that connected the account.
- Honest disclosure that replies may come from an automated assistant where the law or Meta requires it.

## Unverified

Delivery to Meta's Graph API, the review forms themselves, and real webhook delivery from non-tester accounts have
never been exercised.
