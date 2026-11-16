# Master Prompt — Neutral-brand revamp + participant details capture

## Context
Flask app (`app.py`) serving a slide deck, an admin dashboard, a facilitator console and a
phone-join page (`/join/<code>`, embedded in `app.py`). Labs = sessions (room codes). See
`docs/APPLICATION_STATE.md`.

## Goals
1. **Clean branding.** Remove "Synergy" / SYN logo from everything users see: page titles,
   headers, logos, footers, join/waiting/intro screens, admin + console chrome, deck titles/meta,
   export filenames. Neutral name: "Cyber Security Awareness Program".
2. **Capture participant details on join.** Fields: Full name* (required), Contact number*
   (required), Role / occupation, Email, Company (optional). Required fields starred.
   Validate client + server. Store in `sess["participantMeta"][pid]` (persisted to
   `data/sessions.json`); expose via existing admin endpoints. Remember in localStorage.
3. **Refine labs / templates / flow** for the general audience, one step at a time:
   join → waiting → intro → activity → complete, same template language across all 7 modules.

## Non-goals
- Do not rewrite phishing-scenario content (fake/real `synergymarinegroup` domains in lab
  JSON/SVGs) — lesson content, handled as a separate pass if wanted.
- No refactors unrelated to the above. Minimal diffs.

## Rules
Surgical changes; verify each step (run server, hit join API, grep for leftovers) before
claiming done.

## Order
A. Join form + backend (details capture)  →  B. Branding removal in UI chrome  →
C. Exports / titles / meta  →  D. Lab template + flow polish  →  E. Verify + docs update.
