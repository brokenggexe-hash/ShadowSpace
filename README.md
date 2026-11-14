# SHADOWSPACE

**Your Space. Your Identity. Your Community.**

ShadowSpace is a full-stack, real-time social communication platform built with React, TypeScript, Tailwind CSS, Express, WebSockets, WebRTC, Firebase Authentication, Cloud Firestore, and Firebase Storage. It is 100% free with zero paywalls, no Nitro-style subscriptions, and independent user accounts.

## Architecture

- **Frontend (`/src`)**: React 19 + TypeScript + Vite + Tailwind CSS v4 with dark/light modes, accent presets, font-size scaling, compact/comfortable density, reduced-motion & high-contrast toggles.
- **Entry Experience**: Fully functional calculator (`+`, `-`, `×`, `÷`, `%`, `±`, `.`, keyboard shortcuts, interactive history) with an explicit, clearly labeled **Enter ShadowSpace** button.
- **Backend (`/server.ts`, `/backend/src`)**: Express REST API + WebSocket server (`/ws`) providing token-verified endpoints, sliding-window rate limiting, Zod payload validation, live presence, typing indicators, WebRTC signaling, Discord OAuth2 authorization-code linking, moderation actions, and owner-only platform oversight.
- **Database & Rules**: Cloud Firestore (database ID from `firebase-applet-config.json`), split-collection PII isolation (`users/{uid}` vs `users/{uid}/private/account`), and hardened ABAC `firestore.rules` + `storage.rules`.
- **Android Packaging (`/capacitor/capacitor.config.ts`)**: Shared web build & backend configuration ready for Capacitor Android builds.

## Environment Variables

Configure these in your runtime environment (see `.env.example` for template):

- `APP_URL`: Public URL of the running app (used to build the Discord OAuth2 callback URL `<APP_URL>/auth/discord/callback`).
- `PORT`: Server port (default `3000`).
- `DISCORD_CLIENT_ID`: Optional Discord OAuth2 Application Client ID.
- `DISCORD_CLIENT_SECRET`: Optional Discord OAuth2 Application Client Secret (server-only).
- `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`: Optional TURN relay credentials for restrictive NAT traversal in WebRTC voice channels.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: Optional Firebase service account JSON string.

## Firebase Console Setup Notes

1. **Email/Password Authentication**: Enable **Email/Password** in Firebase Console -> **Authentication -> Sign-in method** alongside Google Sign-In so email registration, email verification, and password resets operate end-to-end.
2. **Discord OAuth2 Callback URL**: Register `<APP_URL>/auth/discord/callback` in the Discord Developer Portal -> OAuth2 Redirects.

## Scripts

- `npm run dev` — Starts the Express + WebSocket + Vite middleware server on port `3000`.
- `npm run build` — Compiles the Vite production bundle into `dist/`.
- `npm start` — Starts `server.ts` in production mode serving `dist/`.
- `npm run lint` — Runs `tsc --noEmit` type-checking across frontend and backend TypeScript files.

## Android (Capacitor) Packaging

```bash
npm run build
npx cap add android
npx cap sync android
npx cap open android
```
