# ShadowSpace Firestore Security Specification (Phase 0)

## 1. Core Data Invariants
1. **PII Split Isolation**: Public profile fields (`/users/{userId}`) never contain email addresses or private moderation flags. PII (`email`, `ageVerified`, `afterDarkConsent`, `suspended`, `discordId`) lives exclusively in `/users/{userId}/private/{docId}`, readable/writable only by the account owner or a verified platform admin.
2. **Verified Identity Enforcement**: Every write operation mandates `request.auth != null && request.auth.token.email_verified == true`.
3. **Zero Client-Side Role Escalation**: Users cannot assign themselves `'owner'`, `'admin'`, or `'moderator'` roles on existing servers, cannot insert themselves into `/admins`, and cannot alter `suspended` flags on their private doc.
4. **Master Gate & Membership Sync**: Server channel creation, pinning, and private server reads require verified active membership (`serverMembers/{serverId}_{uid}` with `banned == false`).
5. **Query Enforcer (No `get()` in `allow list`)**: Every `allow list` rule evaluates `resource.data` directly without document lookups (`get()`/`exists()`), preventing O(n) read-amplification attacks and unauthorized collection scraping.
6. **Temporal & Structural Integrity**: All `createdAt` / `updatedAt` timestamps must equal `request.time`. All document IDs are validated with `isValidId()`. Every string and bounded list enforces strict `.size()` bounds.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Ghost Field Shadow Injection (`users/{uid}`)**: `{ uid, username, displayName, ..., isAdmin: true, nitro: true }` -> **MUST DENY** (`hasOnly` rejection).
2. **Identity Spoofing on Message (`messages/{id}`)**: Authenticated as `userA`, submitting `{ authorId: "userB", ... }` -> **MUST DENY** (`authorId == request.auth.uid`).
3. **Admin Escalation (`admins/{uid}`)**: Non-admin attempting `create` on `/admins/{uid}` -> **MUST DENY**.
4. **Email Spoof Admin Bypass**: User with `request.auth.token.email == 'brokengg.exe@gmail.com'` but `email_verified == false` attempting admin write -> **MUST DENY**.
5. **PII Blanket Read (`users/{otherUid}/private/account`)**: Authenticated `userA` reading `userB`'s private PII doc -> **MUST DENY**.
6. **Private Message Scraping (`messages` list)**: Querying `messages` without `scopeType == 'dm' && uid in participantIds` or `isPublicChannel == true` -> **MUST DENY**.
7. **Server Role Self-Promotion (`serverMembers/{serverId}_{uid}`)**: Member updating their own `role` from `'member'` to `'owner'` -> **MUST DENY**.
8. **Banned Member Channel Write**: User with `serverMembers/{serverId}_{uid}.banned == true` attempting to create a message or channel -> **MUST DENY**.
9. **Resource Poisoning (`servers/{longId}`)**: Creating a document with a 500-char ID or 100KB `name` string -> **MUST DENY** (`isValidId` & string `.size()`).
10. **Terminal State Mutation (`friendRequests/{id}`)**: Modifying a `friendRequest` whose `status` is already `'accepted'` or `'rejected'` -> **MUST DENY**.
11. **Backdated Timestamp Attack**: Submitting `createdAt` set to a client-chosen past timestamp instead of `request.time` -> **MUST DENY**.
12. **Unverified Email Write**: Newly signed-up email user with `email_verified == false` attempting to write to `messages` or `servers` -> **MUST DENY**.
