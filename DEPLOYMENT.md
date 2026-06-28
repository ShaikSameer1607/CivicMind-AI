# CivicMind AI — Deployment Guide

Production deployment preparation for the CivicMind AI SPA (Vite + Firebase + Gemini).

---

## Prerequisites

- Node.js 18+
- Firebase project: `civicmindai-e5397` (or update `src/services/firebase.js`)
- Firebase CLI: `npm install -g firebase-tools`
- Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)

---

## Environment Variables

Copy `.env.example` to `.env` (never commit `.env`):

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Recommended | Powers Gemini agents + Copilot. Without it, heuristic fallbacks run. |
| `FIREBASE_STORAGE_ENABLED` | Optional | `true` only when Firebase Storage is provisioned. Default: `false`. |

Restart the dev server after changing `.env`.

---

## Firebase Storage (Optional Mode)

### Disabled (default — `FIREBASE_STORAGE_ENABLED=false`)

- Users can submit reports with images selected locally.
- First image is passed in-memory to the Vision Inspector / Gemini as a data URL.
- Firestore `imageUrls` / `videoUrls` / `audioUrls` remain empty.
- Toast/info: *"Media persistence is unavailable. AI analysis and issue reporting will continue normally."*

### Enabled (`FIREBASE_STORAGE_ENABLED=true`)

1. Enable **Firebase Storage** in Firebase Console.
2. Deploy storage rules: `firebase deploy --only storage`
3. Set `FIREBASE_STORAGE_ENABLED=true` in `.env`.
4. Rebuild: `npm run build`

Media uploads go to `evidence/{uid}/{issueId}/{images|videos|audio}/` and URLs are saved on the issue document.

---

## Firestore Security Rules

Deploy rules:

```bash
firebase deploy --only firestore:rules
```

### Summary

| Collection | Access |
|------------|--------|
| `users` | Users read/write own profile. **Role must be `Citizen` on signup.** Role changes blocked. Admins read all profiles. |
| `issues` | Authenticated read. Citizens create own issues. Citizens **cannot** modify `status`, `department`, `escalationLevel`, `agentAnalysis`, or `trustScore`. Admins full update/delete. |
| `agent_logs` | **Admin read only.** Any signed-in user can create (pipeline). Admin update/delete. |
| `notifications` | Users read/update **only** documents where `userId == auth.uid`. |

---

## Composite Indexes

Current queries use **single-field filters only** — no composite indexes required:

| Query | Collection | Fields |
|-------|------------|--------|
| All issues | `issues` | (none) |
| User issues | `issues` | `createdBy == uid` |
| Notifications | `notifications` | `userId == uid` |
| Agent logs | `agent_logs` | `limit(50)` |

`firestore.indexes.json` is included (empty). If you add `orderBy` + `where` later, Firebase Console will provide a creation link; the app shows a friendly index error via toast/banner.

---

## Administrator Configuration

### Create an Administrator

1. User signs up normally (role is always stored as `Citizen` per security rules).
2. In **Firebase Console → Firestore → users → {uid}**:
   - Set `role` to **`Administrator`**
3. User signs out and back in (or refresh) to load the updated profile.

### Administrator Access

| Route | Path | Guard |
|-------|------|-------|
| Admin Portal | `#admin` | `currentProfile.role === 'Administrator'` |
| Agent Command Center | `#agents` | Same |

Citizens attempting `#admin` or `#agents` are redirected to `#dashboard`.

### Capabilities

- Issue status, department, escalation, resolution
- Agent log visibility (Agent Command Center)
- Department workload and activity history

---

## Build & Deploy

### Verify production build

```bash
npm install
npm run build
npm run preview
```

### Deploy Firestore rules

```bash
firebase login
firebase use civicmindai-e5397
firebase deploy --only firestore:rules
```

### Deploy Storage rules (optional)

```bash
firebase deploy --only storage
```

### Deploy to Firebase Hosting

```bash
npm run build
firebase deploy --only hosting
```

*(Add a `hosting` section to `firebase.json` if not yet configured.)*

---

## Deployment Checklist

- [ ] `.env` created locally; **not** committed
- [ ] `GEMINI_API_KEY` set (or accept heuristic mode)
- [ ] `FIREBASE_STORAGE_ENABLED` set appropriately
- [ ] `npm run build` succeeds
- [ ] `firebase deploy --only firestore:rules` completed
- [ ] Storage rules deployed (if Storage enabled)
- [ ] At least one Administrator user configured in Firestore
- [ ] Test citizen report → pipeline → dashboard
- [ ] Test admin assign / escalate / resolve
- [ ] Test Copilot on Intelligence Suite
- [ ] Test notifications bell (read / mark read)

---

## Workflow Verification

### Citizen

Login → Submit Report → Gemini + 7-agent pipeline → Dashboard update → Notifications

### Administrator

Login → Admin Portal → Assign department → Escalate → Resolve → Agent Command Center logs

### Copilot

Intelligence Suite → Ask question → Firestore context + Gemini response

---

## Production Recommendations

1. **Gemini API key** — Move to a backend proxy before wide public launch (client bundle exposes the key).
2. **Firebase Hosting** — Enable HTTPS, configure caching headers for `dist/assets/`.
3. **Admin provisioning** — Never allow self-registration as Administrator (enforced in rules).
4. **Monitoring** — Enable Firebase Crashlytics / Performance if needed.
5. **Backups** — Enable Firestore scheduled exports for production data.
6. **Legacy files** — `src/main.ts`, `src/router.ts`, static HTML mockups are unused by the live app; safe to remove in a future cleanup pass.

---

## Secrets & Git

`.gitignore` excludes `.env`, `.env.*`, and `dist/`. Never commit API keys or service account JSON.
