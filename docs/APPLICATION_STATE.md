# Application State — Synergy Cyber Security Awareness Month

Reference document for the live-event application: the standalone presentation console plus
the admin/phone-sync live-poll system built on top of it. Last verified end-to-end: 2026-09-08.

This is a living reference — if a future change alters routes, modules, or config, update this
file in the same change.

---

## 1. The 8 modules

There are two separate front ends sharing the same `content/*.json` files:

- **Standalone console** (`live-event/index.html` + `live-event/modules/*.js`) — runs on one
  screen (the facilitator's laptop/projector), self-contained, no login, no participants.
- **Admin/phone-sync system** (`admin/dashboard.html` + the embedded `/join/<code>` page in
  `app.py`) — the facilitator drives an activity from the admin dashboard; participants follow
  along and answer on their own phones.

**7 of the 8 modules are phone-synced** (launchable from the admin dashboard's picker, backed by
`GET /api/admin/modules`). **1 is facilitator-only** — it runs on the console but is never
pushed to phones.

| # | Module | Phone-synced? | Items | Teaches |
|---|---|---|---|---|
| 1 | Fault Finding | ✅ (5 of 8 console items — see note) | 5 | Spot the tell between a real and a spoofed email/portal (domain spoofing, urgency framing, malicious attachments, link mismatches, lookalike login pages). |
| 2 | Live Simulation | ❌ facilitator-only | — | Walks one attack chain end-to-end (LinkedIn recon → phishing → fraudulent wire transfer) as a narrated, linked sequence — not a per-item quiz. |
| 3 | Myth vs Fact | ✅ | 10 | Busts common phishing/password/social-engineering misconceptions as a True/False poll (half the items show the myth, half show the fact restated — see §7 below). |
| 4 | Decision Room | ✅ | 10 (10 cases, each exactly one scenario → one decision → one debrief) | Incident-response scenarios — pick a response, see the consequence and the debrief, across HR/Recruitment, HR/Payroll, Finance/Accounts, Offshore Crew, and Operations personas. Merged with the former standalone "Closing Quiz"/Rapid Fire module (2026-09-08), then flattened and trimmed from 34 items/16 cases down to 10 for live facilitation (2026-09-08) — see the two notes below. |
| 5 | Clue Quest | ✅ | 9 | Riddle → guess-the-term recall game covering terminology from earlier modules. |
| 6 | Pass-Phrase | ✅ | 5 | Build a strong password from a rebalanced 15-chunk themed deck (scarce premium: 2-3 upper/symbol/number chunks) into a 15-char password row (chunk-aware cap, slot mechanics preserved), watching a live strength meter. Console: drag-and-drop + facilitator-only ceiling hint + once-per-round shuffle + tier-pulse animation. Phone: tap-to-place (tap deck tile, then tap slot) + same shuffle/pulse — same mechanic, touch-appropriate; see §5 for deck relation and §5a for quality ranking. |
| 7 | Crossword | ✅ (self-paced) | 1 grid (11 clues / 73 letters) | Vocabulary recall, fill-in grid — no per-item push, participants (and the console) work the same 16×10 grid at their own pace. |
| 8 | Control Catch | ✅ (self-paced) | 1 game (75s round) | Falling-bubble reflex game — tap the good security habits as they fall, let the bad ones pass; 3 lives, a personal score never shown to or compared with other participants. |

**Note on Defense Budget:** removed entirely (2026-09-07) — was facilitator-only, never
phone-synced, never referenced in `app.py` or `GET /api/admin/modules`. Deleted
`modules/defense-budget.{html,js}`, `content/defense-budget.json`, its card from
`live-event/index.html`, and its `.db-*` rules from `console.css`.

**Note on the Decision Room + Closing Quiz merge (2026-09-08):** the two modules sat back-to-back
in the narrative flow and felt too similar as two separate stand-and-deliver decision activities.
Rather than delete either one, every piece of Closing Quiz's content was folded into Decision
Room's own case/decision/outcome shape as additional cases (a quiz question became a decision
scored good/consequence like every other decision — the single shared `explanation` became every
option's `feedback`, since Closing Quiz always revealed the same text regardless of which choice
was tapped; a Stop-Verify-Report prompt became a debrief-only case, since it was always pure
narration+reveal, never an actual multi-choice question). `closing-quiz` (id, routes,
`content/closing-quiz.json`, `modules/closing-quiz.{html,js}`) is fully retired — `decision-room`
survives as the one merged module, same id/displayName/URL as before. This merge produced an
intermediate 34-item/16-case shape (mixing 3-decision cases with 1- and 0-decision ones, two
console timer paces); that intermediate shape was itself simplified away the same day — see the
next note.

**Note on the Decision Room flatten-and-trim (2026-09-08):** 34 items across 16 cases (some with
up to 3 sequential decisions) was too much for a facilitator to navigate live via the admin item
picker. Every case was flattened to its single most essential decision (each multi-decision case
kept only its first decision — the initial "STOP" reflex — since the debrief already synthesizes
the full STOP/VERIFY/REPORT arc regardless of how many decisions led to it), and the pool was
trimmed from 16 cases to the 10 strongest/most distinct: all 4 debrief-only cases with no real
decision to flatten were cut except one (`svr-1`, the only source of the HR/Payroll persona —
kept by giving it a proper decision, 2 new consequence options written in the same voice as the
rest of the content, rather than lose that persona from the rotation entirely), plus 2 more cases
cut for redundant lesson/persona overlap. Every case is now exactly one sequence item — scenario,
one decision (2-4 options), one debrief — with the debrief riding along on that same item as
`caseDebrief`/`myDebrief` (revealed the instant the participant answers, same timing as
`myOutcome`/`myFeedback`) rather than a separate step, so the admin item picker shows exactly 10
entries. The dual console timer (a silent 90s ambient clock for long cases, a brisk ticking 15-20s
one for short cases) collapsed to a single brisk ~20s clock for all 10 — a single decision didn't
carry the old 90s ambient pace the way three did, and quick live navigation is the whole point of
this pass. The phone stays untimed, unchanged from before either pass.

**Note on qr-usb-scam / secure-or-risky / working-at-height:** removed entirely (2026-09-08) —
none were ever linked from `index.html`'s module grid or phone-synced, and none were referenced
anywhere in `app.py`. Deleted `modules/qr-usb-scam.{html,js}`, `modules/secure-or-risky.{html,js}`,
`modules/working-at-height.{html,js}`, their three `content/*.json` files, and the `.sr-*`/`.qs-*`
rules from `console.css`. Also deleted 5 unrelated orphaned prototype files that had no matching
HTML/content and no references anywhere (`modules/scoreboard.js`, `attack-sim.js`, `defense-lab.js`,
`quiz.js`, `deepfake.js`) plus `live-event/simulation.js` and `live-event/training.css`, all
leftovers from an earlier, abandoned `window.SimulationModules`/`window.TrainingState` prototype.

**Note on Fault Finding's 5-of-8 split:** `content/fault-finding.json` has 8 items; the console
shows all 8. Only the 5 `"type": "compare"` items (genuine real-vs-fake judgment tasks) are
pushed to phones — the other 3 (`smishing-text`, `fake-it-popup`, `mfa-fatigue`) are single-image
reference cards with nothing to compare/choose between, so they stay console-only. See
`_load_module_sequence` in `app.py`.

---

## 2. How to run

### Standalone console (now admin-login-gated — see note below)
Open **`/live-event/index.html`** on the presentation machine, logged in as admin. Click a
module card, run it, press the browser back button (or the console's own nav) to return to the
menu. It still touches nothing in the admin/session system functionally — it reads
`content/*.json` directly and keeps zero server-side session state of its own — but the page
itself now requires the same admin session cookie as `/admin`.

> **Access-model change:** earlier passes of this project explicitly verified and documented the
> standalone console as having "zero dependency on the admin/session system," including no
> login. That has been **reversed** — `/live-event/index.html` and the 8 module pages under
> `/live-event/modules/*.html` now redirect an unauthenticated visitor to `/admin`'s login form
> (see `live_event_index`/`live_event` in `app.py`). This is a deliberate access-control decision
> for this event, not a regression of the earlier no-auth verification — that verification was
> accurate for its time. Gating is scoped to the HTML pages only: `console.css`, `console.js`,
> `content/*.json`, and `assets/*` under the same `/live-event/` path stay public, because the
> phone-synced `/join/<code>` page also depends on them (console.css's own `@import` chain,
> fault-finding's real email images) and participants are never admin-authenticated — gating the
> whole path would have silently broken every participant's phone view along with the console.

### Admin / phone-sync mode
1. Facilitator opens **`/admin`** (or `/admin/`, `/admin/dashboard`) and logs in with
   `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
2. Click **New Session** → get a 6-character room code + QR code (QR encodes
   `https://<host>/join/<CODE>`, built from the live request host, so it works unmodified on
   Render or a custom domain).
3. Participants scan the QR (or type the join URL) → land on `/join/<CODE>` → enter a display
   name → they're in the room, waiting for the host.
4. Facilitator picks a module in the picker grid → **Launch** (creates a lobby) → **Start**
   (pushes item 1) → **Next** through the sequence → **Complete** → **Choose Next Activity**
   (returns to the picker without re-scanning) → repeat for the next module. Same room code,
   same participants, for the whole event.
5. **Reset This Room** (admin dashboard) wipes participants/responses so the *same* room code
   can be handed to a *different* group later in the day.

---

## 3. Config & credentials

| Variable | Purpose | Where it's set |
|---|---|---|
| `ADMIN_USERNAME` | Facilitator login username | `.env` locally; Render → service → Environment |
| `ADMIN_PASSWORD` | Facilitator login password | same |
| `FLASK_SECRET_KEY` | Signs the admin session cookie | same |

- Local dev: copy `.env.example` → `.env` (gitignored, never committed) and fill in real values;
  `app.py` loads it via `python-dotenv` at startup.
- Render (or any host that injects env vars natively): set the same three variables in the
  service's Environment settings — `.env` is not needed there and is not read if absent.
- `requirements.txt` pins `Flask`, `python-dotenv`, `qrcode`, `Pillow` at currently-verified
  versions.
- Session persistence lives in `data/sessions.json` (gitignored — see §4) — this is runtime
  state, not configuration, and never needs to be set up manually.

---

## 4. Persistence (Render-restart survival)

`SESSIONS` (the in-memory room/participant/response store) mirrors to a single JSON file,
`data/sessions.json`, written atomically (temp file + `os.replace`) after every state-mutating
route and reloaded at process startup. A Render dyno sleep, redeploy, or crash mid-event now
resumes the same room code, same participants, same mid-activity state — verified by forcibly
killing and restarting the process mid-crossword and confirming full recovery, repeated after a
full 7-module run.

`GET /health` → `{"ok": true, "sessionsLoaded": <n>}` — public, unauthenticated. The app does
**not** self-ping; if you're on a Render tier that sleeps on idle, point an external uptime
service (UptimeRobot, cron-job.org, etc.) at this endpoint during the event.

---

## 5. Admin-only correctness & "Fastest Overall" summary

`GET /api/admin/session/<code>/module-summary?module=<id>` ranks participants for the room's
**currently loaded** module (once a new module is launched, the old one's sequence is gone —
this only ever answers for whichever module is presently active or was just marked complete).
Surfaced in the admin dashboard as a "Fastest Overall" panel the moment an activity is marked
complete. Entirely admin-only — confirmed by test that none of it (`ranked`, `inProgress`,
`correctCount`, `completedAt`, `moduleStartedAt`, `rank`) ever appears in a participant-facing
`/state` or `/respond` response.

**Which modules have objective correctness data today** (a `correctOptionId` set on the
module's normalized items — see `_normalize_module_item` in `app.py`) vs. which don't — this is
a deliberate content/scope difference, not a bug if module-summary shows `"hasCorrectness":
false` for one you expected to be scored:

| Module | Has correctness? | Ranked by |
|---|---|---|
| Myth vs Fact | ✅ (`isTrue`/`correctOptionId` from the True/False restructure) | correctCount desc, then completedAt asc |
| Fault Finding | ❌ | completedAt asc |
| Decision Room | ❌ (every one of its 10 cases is tagged good/consequence via `goodOptionId`, never `correctOptionId`; this is deliberate, not a gap, since the merge with the former Closing Quiz needed exactly one consistent admin-facing metric, not two competing ones — see the merge note in §1) | goodCount desc ("good decisions"), then completedAt asc |
| Clue Quest | ❌ (no answer key stored on the normalized item) | completedAt asc |
| Pass-Phrase | ✅ (quality-based: avg %-of-best vs per-round theoretical max, admin-only — see below) | avgPctBest desc, then completedAt asc |
| Crossword | ❌ (free-text grid, not scored; ranked via `crosswordProgress` instead of `responses` — no per-participant `moduleStartedAt` either, since crossword only retains each participant's *latest* debounced ping, not their first) | completedAt asc |
| Control Catch | ✅ (score = good bubbles popped, stored in the generic `correctCount` field/ranking path — the admin dashboard just relabels the text to "good bubbles popped"/"good caught" for this module, see `pollResultsForRunning`/`renderFastestOverall` in `admin/dashboard.html`) | correctCount desc, then completedAt asc |

If a future pass wants Clue Quest scored too, that means authoring a `correctOptionId` (or
equivalent) onto its normalized items — `_compute_module_summary` already picks up
`correctOptionId` generically the moment any module sets it, no ranking-logic change needed.

**Pass-Phrase is also a special case for ranking** — rebalanced 2026-09: keyed by
`roundId` via `POST /passphrase/build` (`sess["passphraseBuilds"]`), but ranked by
**average %-of-best**: for each round the server brute-forces the theoretical best
achievable score from that round's specific 15-chunk deck+weak within the 15-char cap
(not a fixed 100) via `_pp_theoretical_best`, then tracks each participant's actual
score as a % of that deck's best (e.g. "87% of best possible for this deck") in
`admin/passphrase/progress` and `_compute_module_summary`. Admin dashboard shows
`avg %-of-best` per participant and per-round bests; module-summary ranks by that avg
(admin-only, per no-participant-facing-ranking rule — participants only ever see their
own live meter). "Complete" still means built something in all 5 rounds, but ranking is
quality-based, not just completion time.

**How the console's deck and the phone's deck relate:** the console (`pass-phrase.js`)
procedurally generates a fresh random `weakPassword` + 15-chunk deck (scarce premium pool,
cap 15) on every render via `generateWeakPassword()`/`generateDeck()` — never the same
twice, even for the same round. The phone instead reads a **fixed** `weakPassword` + `deck`
per round from `content/pass-phrase.json`, generated **once** by
`scripts/gen_passphrase_content.py` (which calls the Python ports of those same functions,
`_pp_generate_weak_password`/`_pp_generate_deck` in `app.py`, using the same scarce-pool
+ chunk-aware 15-char cap logic) so the deck stays fixed for the whole activity, like every
other module's content, instead of reshuffling on every launch. The two surfaces will
therefore show *different* weak passwords/decks from each other —
by design, not a bug — but the same mechanic: a themed deck, a 12-slot password row, a live
strength meter (`_pp_compute_strength` in `app.py` is a direct, verified-identical port of the
console's own `computeStrength()`). Regenerate the phone's content by re-running that script if
the rounds' `weakPassword`/`deck` ever need refreshing.

---

## 6. Known, accepted open items

These were identified and deliberately left alone across earlier passes — they are **known
trade-offs, not bugs waiting to be found again**:

- **Crossword's self-paced model vs. the item-sequence model.** The other 6 phone-synced modules
  walk a `moduleSequence` one item at a time via `/start` → `/next`. Crossword is a single static
  grid item — `/start` unlocks it for everyone at once, and any `/next` ends the activity
  immediately (self-paced, no discrete steps). This asymmetry is intentional, not a bug.
- **No `AbortController`/sequence-token on the poll loops.** Both the admin dashboard's
  `pollOnce()` and the participant page's `fetchState()` fire a new request every 1.5s with no
  guard against an out-of-order response from an earlier, slow in-flight request landing after a
  newer one. Never observed to cause a real issue; flagged as a hardening opportunity if
  intermittent stale-render reports ever surface.
- **Item IDs are not module-scoped.** `sess["responses"]` is keyed by `itemId` only. If two
  modules' content files ever produced the same generated ID, responses could in principle bleed
  across an activity boundary. Not currently possible given how IDs are generated today, but not
  structurally prevented either.
- **Admin session timeout is a flat 12 hours,** no idle timeout, no CSRF token (relies on the
  session cookie + same-origin fetches from the dashboard's own JS). Deliberately long-lived so a
  facilitator is never logged out mid-event; revisit if this tool is ever exposed beyond a single
  trusted operator per event.
- **Fault Finding's persona rotation has a small gap:** 4 of its 5 phone-synced items carry a
  `persona` tag (HR/Recruitment, Finance/Accounts, HR/Payroll, Offshore Crew); the 5th
  (`compare-login-portal`) has none. Decision Room's persona rotation (all 10 cases) covers all
  five named personas — HR/Recruitment ×2, HR/Payroll ×1, Offshore Crew ×2, Finance/Accounts ×2,
  Operations ×3. Not fixed here — it's a content-authoring call, not a code bug.
---

## 7. Before your next live event — checklist

- [ ] Confirm `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `FLASK_SECRET_KEY` are set in Render's
      Environment settings (not left on defaults).
- [ ] Hit `GET /health` on the live URL — confirm `{"ok": true}`.
- [ ] Create a real test room from `/admin`, scan the QR **from a phone on the venue's actual
      Wi-Fi/network**, join, and confirm a poll round-trips (this catches venue-network/firewall
      surprises that `localhost` testing can't).
- [ ] If the event runs long enough that a Render sleep/idle cycle is plausible, either point an
      external uptime pinger at `/health` for the duration, or confirm you're on a tier that
      doesn't sleep — persistence means a sleep/restart now recovers cleanly, but it still means a
      few seconds of "Reconnecting…" on participants' phones while it wakes back up.
- [ ] If you want to inspect `data/sessions.json` after an event (attendance, response counts),
      remember it's gitignored — it lives only on the Render instance's disk (or wherever the
      process ran), not in the repo.
