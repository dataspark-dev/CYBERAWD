#!/usr/bin/env python3
"""
Synergy Cyber Security Awareness Month — presentation server.

Serves the static viewer (index.html, scripts, styles, assets, slides)
over Flask. Validates that every slide listed in deck.js actually exists
on disk at startup.
"""

import io
import os
import re
import sys
import json
import math
import uuid
import string
import random
import socket
import secrets
import hashlib
from pathlib import Path
from datetime import datetime, timezone, timedelta
from functools import wraps

# Load .env for local development (see .env.example). On Render, set
# ADMIN_USERNAME / ADMIN_PASSWORD / FLASK_SECRET_KEY in the service's
# Environment settings — .env is gitignored and for local dev only.
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

from flask import Flask, send_from_directory, abort, request, jsonify, session, Response, redirect
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

ROOT = Path(__file__).resolve().parent
DECK_JS = ROOT / "scripts" / "deck.js"
SLIDES_DIR = ROOT / "slides"
SCRIPTS_DIR = ROOT / "scripts"
STYLES_DIR = ROOT / "styles"
ASSETS_DIR = ROOT / "assets"
LIVE_EVENT_DIR = ROOT / "live-event"
ADMIN_DIR = ROOT / "admin"
INDEX_HTML = ROOT / "index.html"

SLIDE_ENTRY_RE = re.compile(r"\{\s*file:\s*['\"](?P<file>[^'\"]+)['\"]")

app = Flask(__name__)
# Per-IP rate limiting for the public, unauthenticated participant routes — this is now reachable
# on the open internet (not just venue WiFi), so a scripted flood of fake joins/responses against
# a live room is possible without it. No app-wide default_limits: admin routes are already behind
# login, and static/content GETs don't need throttling — only the specific mutating participant
# endpoints below opt in via @limiter.limit(...). In-memory storage (default) is fine at this
# scale, matching the existing single-process, in-memory-plus-disk-persistence SESSIONS design.
# Limits are per-IP but generous, since real participants often share one NAT'd IP (venue WiFi/
# corporate network) — sized to comfortably cover a full room self-pacing through a module, not
# to cap legitimate classroom-sized concurrent use.
limiter = Limiter(get_remote_address, app=app, default_limits=[], storage_uri="memory://")
# -- session / admin config (additive, does not affect existing routes) --
# Env vars (see .env.example for local dev; on Render set in Environment settings):
#   ADMIN_USERNAME, ADMIN_PASSWORD, FLASK_SECRET_KEY
# .env is gitignored via .gitignore; .env.example holds placeholders only.
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD") or os.environ.get("ADMIN_PASS") or "change-me"
# FLASK_SECRET_KEY is the canonical name; SECRET_KEY kept as fallback for older deploys.
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or os.environ.get("SECRET_KEY") or "change-this-to-a-random-string"
# Admin login session: permanent cookie so facilitator isn't logged out mid-event.
# Flask default is 31 days; we set explicit 12h to be safe for a live Synergy Cyber Security Awareness Month
# session while still expiring reasonably. With `session.permanent=True` in login,
# this lifetime controls expiry. 12h >> typical 2-4h event, so no mid-event logout.
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(hours=12)
app.permanent_session_lifetime = timedelta(hours=12)
# Idle timeout — logs an admin out after this long with no admin API activity, independent of
# (and shorter than) the 12h absolute cookie lifetime above. See _gate_admin_routes.
ADMIN_IDLE_TIMEOUT = timedelta(hours=2)

# In-memory room/session store (state machine for whole-activity flow):
# {
#   roomCode: {
#     "roomCode": str,
#     "createdAt": iso8601,
#     "participants": { participantId: name },
#     "participantMeta": { participantId: {"name": str, "joinedAt": str} },
#     "activeModule": str | None,
#     "state": None | "lobby" | "running" | "complete" | "idle",  # lobby=chosen but not started, running=item 0..N-1,
#                                                                  # complete=past last, idle=back at picker post-complete
#     "moduleSequence": [],  # server-side loaded normalized items for activeModule (participants only see currentItem)
#     "currentItemIndex": None | int,
#     "activeItem": dict | None,  # {id, prompt, options:[{id,text}], fact?, answerId?, revealed?} — only while running
#     "responses": { itemId: { participantId: {"optionId": str, "respondedAt": iso8601} } },
#     "crosswordProgress": { participantId: { filledCount:int, totalCount:int, updatedAt:iso } },
#     "passphraseBuilds": { participantId: { roundId: {builtPassword, strength, updatedAt} } },
#     "submissions": { participantId: { moduleId: submittedAt_iso } }  # per-participant per-module deliberate Submit
#   }
# }
SESSIONS: dict = {}

# --- Disk persistence (Render-restart survival) ---
# SESSIONS is in-memory only, which means a Render free/hobby dyno sleep, redeploy, or crash
# wipes every room, participant, and response mid-event. Rather than adding a real database
# (overkill for one facilitator running one event at a time), SESSIONS is mirrored to a single
# JSON file on disk and reloaded at process startup — a plain file is exactly enough durability
# for this tool's actual concurrency (one writer, occasional bursts) without a new service
# dependency. Every value already stored in SESSIONS is plain str/int/bool/None/list/dict
# (timestamps are pre-formatted iso8601 strings), so it round-trips through json.dump/load with
# no custom encoder.
DATA_DIR = ROOT / "data"
SESSIONS_FILE = DATA_DIR / "sessions.json"


def _save_sessions_to_disk():
    """Atomic write (temp file + os.replace) so a crash mid-write can't corrupt the file.

    Called only from state-mutating routes — poll/read routes (GET /state, GET /results,
    GET /dashboard, etc.) never call this, so the 1.5s admin/participant polling cadence
    never triggers a disk write.
    """
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        tmp_path = SESSIONS_FILE.with_suffix(".json.tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(SESSIONS, f)
        os.replace(tmp_path, SESSIONS_FILE)
    except Exception as e:
        print(f"WARNING: failed to persist sessions to {SESSIONS_FILE}: {e}", file=sys.stderr)


def _load_sessions_from_disk():
    """Repopulate SESSIONS from disk at startup so a restart resumes where the event left off."""
    if not SESSIONS_FILE.exists():
        return
    try:
        with open(SESSIONS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            SESSIONS.clear()
            SESSIONS.update(data)
            print(f"Loaded {len(SESSIONS)} session(s) from {SESSIONS_FILE}")
    except Exception as e:
        print(f"WARNING: failed to load {SESSIONS_FILE}: {e}", file=sys.stderr)


def persist_after(f):
    """Route decorator: save SESSIONS to disk after the wrapped view function returns.

    Applied only to state-mutating routes (create/join/respond/launch/start/next/reveal/
    reset/return-to-picker/crossword-progress) — see the call sites below.
    """
    @wraps(f)
    def wrapper(*args, **kwargs):
        result = f(*args, **kwargs)
        _save_sessions_to_disk()
        return result
    return wrapper


_load_sessions_from_disk()

# 7 live-poll modules — whole-activity, content pulled from existing content/*.json
# (counts read at request time, never hardcoded)
MODULE_DEFS = [
    {"id": "fault-finding", "displayName": "Fault Finding", "content": "fault-finding.json"},
    {"id": "myth-vs-fact", "displayName": "Myth vs Fact", "content": "myth-vs-fact.json"},
    {"id": "decision-room", "displayName": "Decision Room", "content": "decision-room.json"},
    {"id": "closing-quiz", "displayName": "Closing Quiz", "content": "closing-quiz.json"},
    {"id": "clue-quest", "displayName": "Clue Quest", "content": "clue-quest.json"},
    {"id": "pass-phrase", "displayName": "Pass-Phrase", "content": "pass-phrase.json"},
    {"id": "crossword", "displayName": "Crossword", "content": "crossword.json"},
]
MODULE_IDS = {m["id"] for m in MODULE_DEFS}
CONTENT_DIR = LIVE_EVENT_DIR / "content"


def _read_module_json(module_id: str):
    """Read content file for module_id at request time (no stale hardcoded counts)."""
    for m in MODULE_DEFS:
        if m["id"] == module_id:
            p = CONTENT_DIR / m["content"]
            if not p.exists():
                return None
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                return None
    return None


def _normalize_module_item(module_id: str, raw, idx: int = 0):
    """Convert raw content entry to normalized {id, prompt, options[], fact?, revealed} for live-poll."""
    # Fallback id
    base_id = raw.get("id") or f"{module_id}-{idx+1}"
    try:
        if module_id == "fault-finding":
            # Phone template shows the real vs fake image pair as two tappable cards (mirroring
            # the facilitator console's ff-compare-panel layout, stacked vertically) — the
            # participant taps whichever card they think is fake. Content-relative image paths
            # (e.g. "../assets/fault-finding/x.svg", relative to live-event/modules/) are
            # rewritten to absolute site paths ("/live-event/assets/fault-finding/x.svg") since
            # this is served from a different URL (/join/<code>), not live-event/modules/.
            # Participant view is deterministic: A always shows the real image, B the fake —
            # so B is always the correct answer (the console randomizes separately per render,
            # participant correctness is fixed per room for stable scoring). This matches the
            # same correctOptionId / isCorrect / _sanitize pattern used for myth-vs-fact.
            def _abs_asset(path):
                if not path:
                    return None
                return "/live-event/" + str(path).lstrip("./")
            return {
                "id": str(base_id),
                "prompt": str(raw.get("title") or base_id).strip(),
                "persona": raw.get("persona"),
                "category": raw.get("category"),
                "realImage": _abs_asset(raw.get("realImage")),
                "fakeImage": _abs_asset(raw.get("fakeImage")),
                "options": _normalize_options([{"id": "A", "text": "Option A is fake"}, {"id": "B", "text": "Option B is fake"}]),
                "correctOptionId": "B",
                "fact": str(raw.get("whyItsSuspicious") or raw.get("whatIsWrong") or ""),
                "revealed": False,
            }
        if module_id == "myth-vs-fact":
            # Yes/No poll: content authors mark isTrue per item — true means the "fact" text
            # itself is shown as the claim to judge, false means the "myth" text is shown.
            # This reuses the existing myth/fact/detail fields as-is (no duplicated content)
            # while producing a genuine mixed True/False quiz instead of always-correct-"Myth".
            is_true = bool(raw.get("isTrue", False))
            claim = raw.get("fact") if is_true else raw.get("myth")
            correct_option_id = "yes" if is_true else "no"
            # Reveal text always surfaces the piece the participant hasn't already been shown:
            # if the claim shown WAS the fact, reveal adds the busted myth as context; if the
            # claim shown WAS the myth, reveal supplies the actual fact + detail.
            if is_true:
                reveal = str(raw.get("detail") or "").strip()
                if raw.get("myth"):
                    reveal = (reveal + (" " if reveal else "") + f"Common misconception: \"{raw['myth']}\"").strip()
            else:
                reveal = str(raw.get("fact") or "").strip()
                if raw.get("detail"):
                    reveal = (reveal + (" — " if reveal else "") + str(raw["detail"])).strip()
            return {
                "id": str(base_id),
                "prompt": str(claim or raw.get("prompt") or base_id).strip(),
                "topic": raw.get("topic"),
                "options": _normalize_options([{"id": "yes", "text": "True"}, {"id": "no", "text": "False"}]),
                "isTrue": is_true,
                "correctOptionId": correct_option_id,
                "fact": reveal,
                "revealed": False,
            }
        if module_id == "decision-room":
            # raw is a decision {prompt, options[]}; _load will flatten cases→decisions and
            # inject caseId/persona/scenario (see _load_module_sequence) so the phone template
            # can show the same persona badge + scenario context as the console.
            # No single "correct" answer — instead track a "good choice" per decision
            # (outcome=="good") as the admin-only analog metric, labeled "good decisions"
            # not "correct answers" so it isn't misread as the same thing. Participant sees
            # no Correct/Not-quite badge here (neutral picked state only); admin sees
            # goodCount alongside progress. Outcome is preserved on each option for that.
            prompt = raw.get("prompt") or raw.get("scenario") or base_id
            opts = raw.get("options") or raw.get("choices") or []
            # Keep original option ids/text for reveal
            norm_opts = _normalize_options(opts if opts else ["Option A", "Option B"])
            # Fact = good outcome feedback
            fact = ""
            try:
                fact = " | ".join([o.get("feedback","") for o in opts if o.get("outcome")=="good"])
            except Exception:
                pass
            # Determine the "good" option id (admin-only scoring, not correctOptionId)
            good_option_id = None
            try:
                for o in opts:
                    if isinstance(o, dict) and o.get("outcome") == "good" and o.get("id"):
                        good_option_id = str(o.get("id"))
                        break
                # fallback: find via normalized outcome if original id missing
                if not good_option_id:
                    for no in norm_opts:
                        if no.get("outcome") == "good":
                            good_option_id = no["id"]
                            break
            except Exception:
                pass
            out = {
                "id": str(base_id),
                "prompt": str(prompt).strip(),
                "persona": raw.get("persona"),
                "caseTitle": raw.get("caseTitle"),
                "caseScenario": raw.get("caseScenario"),
                "options": norm_opts,
                "fact": fact,
                "revealed": False,
            }
            if good_option_id:
                out["goodOptionId"] = good_option_id
            return out
        if module_id == "closing-quiz":
            # raw is question {question, choices} or SVR prompt {scenario, idealResponse} — the
            # phone template needs to tell these apart to render the right visual (qz-choice
            # grid vs svr-scenario-card, matching the console's two distinct item types).
            if "question" in raw:
                norm_opts = _normalize_options(raw.get("choices") or [])
                correct_id = None
                try:
                    ci = raw.get("correctIndex")
                    if isinstance(ci, int) and 0 <= ci < len(norm_opts):
                        correct_id = norm_opts[ci]["id"]
                except Exception:
                    pass
                out = {
                    "id": str(base_id),
                    "kind": "question",
                    "prompt": str(raw.get("question") or base_id).strip(),
                    "persona": raw.get("persona"),
                    "options": norm_opts,
                    "fact": str(raw.get("explanation") or ""),
                    "revealed": False,
                }
                if correct_id:
                    out["correctOptionId"] = correct_id
                return out
            else:
                # SVR prompt — no single correct answer (STOP/VERIFY/REPORT are all part of ideal)
                return {
                    "id": str(base_id),
                    "kind": "svr",
                    "prompt": str(raw.get("scenario") or base_id).strip(),
                    "persona": raw.get("persona"),
                    "options": _normalize_options(["STOP", "VERIFY", "REPORT"]),
                    "fact": str(raw.get("idealResponse") or ""),
                    "revealed": False,
                }
        if module_id == "clue-quest":
            # Single defined answer per riddle — wire same isCorrect pattern as myth-vs-fact/fault-finding
            # for parity (participant Correct/Not-quite badge, admin correctCount). Options are
            # string list, answer is one of them (e.g. "DOMAIN SPOOFING").
            norm_opts = _normalize_options(raw.get("options") or [])
            answer = str(raw.get("answer") or "").strip()
            correct_id = None
            try:
                # case-insensitive match against normalized text
                for o in norm_opts:
                    if o.get("text", "").strip().upper() == answer.upper():
                        correct_id = o["id"]
                        break
                # fallback exact
                if not correct_id:
                    for o in norm_opts:
                        if o.get("text", "").strip() == answer:
                            correct_id = o["id"]
                            break
            except Exception:
                pass
            out = {
                "id": str(base_id),
                "prompt": str(raw.get("riddle") or base_id).strip(),
                "options": norm_opts,
                "fact": str(answer),
                "revealed": False,
            }
            if correct_id:
                out["correctOptionId"] = correct_id
            return out
        if module_id == "pass-phrase":
            # Real build-your-own-password mechanic, matching the console (pass-phrase.js):
            # a themed deck of PP_DECK_SIZE CHUNKS (mixed 2-char pairs like "Ka","Th","on",
            # singles, symbols/numbers) that participants combine — not letter-by-letter — to
            # assemble a password, capped by total character count (PP_MAX_CHARS) not tile count.
            # weakPassword/deck are static content (see content/pass-phrase.json), generated once
            # by scripts/gen_passphrase_content.py using the same pools/composition logic as
            # _pp_generate_weak_password/_pp_generate_deck below, rather than regenerated at
            # request time — this keeps the deck fixed for the whole activity, like every other
            # module's content, instead of reshuffling on every launch. Falls back to a fresh
            # generation only if a round is missing these fields (e.g. hand-added content).
            difficulty = str(raw.get("difficulty") or "medium")
            weak = raw.get("weakPassword")
            deck = raw.get("deck")
            if not weak:
                weak = _pp_generate_weak_password(difficulty)
            if not deck:
                deck = _pp_generate_deck(difficulty, weak)
            # requirement/context caption — reuses content's own hint text ("Weak: X — why")
            # for the part after the dash, if present; falls back to a generic line otherwise.
            hint = str(raw.get("hint") or "").strip()
            requirement = hint.split("—", 1)[1].strip() if "—" in hint else "Rebuild it stronger using the deck below."
            return {
                "id": str(base_id),
                "prompt": None,
                "weakPassword": str(weak),
                "weakRequirement": requirement,
                "deck": list(deck),
                "maxSlots": PP_MAX_SLOTS,
                "maxChars": PP_MAX_CHARS,
                "difficulty": difficulty,
                "options": [],
                "revealed": False,
            }
        if module_id == "crossword":
            # Crossword is one grid, self-paced; no per-item poll. Represent as single grid item.
            return {"id": "crossword-grid", "prompt": "Crossword grid", "options": [], "fact": "", "revealed": False}
    except Exception:
        pass
    # Fallback generic
    return {"id": str(base_id), "prompt": str(raw.get("prompt") or raw.get("title") or base_id).strip(), "options": _normalize_options(raw.get("options") or ["A","B"]), "fact": "", "revealed": False}


def _load_module_sequence(module_id: str):
    """Load and normalize full item sequence for module_id from its content file. Crossword returns 1 grid item."""
    data = _read_module_json(module_id)
    if not data:
        return []
    try:
        if module_id == "fault-finding":
            # Phone-synced activity only includes the "compare real vs fake" cards — genuine
            # judgment tasks. The single-image reference cards (today: smishing-text,
            # fake-it-popup, mfa-fatigue — items 6/7/8 in fault-finding.json) have nothing to
            # compare/choose between, so they're excluded here but stay untouched in the JSON
            # file and keep appearing in the standalone facilitator console, which reads
            # data["items"] unfiltered (see live-event/modules/fault-finding.js).
            compare_items = [r for r in data.get("items", []) if r.get("type") == "compare"]
            return [_normalize_module_item(module_id, r, i) for i, r in enumerate(compare_items)]
        if module_id == "myth-vs-fact":
            return [_normalize_module_item(module_id, r, i) for i, r in enumerate(data.get("items", []))]
        if module_id == "decision-room":
            # Flatten cases -> decisions = 18 steps
            seq = []
            for c in data.get("cases", []):
                for d in c.get("decisions", []):
                    # Keep case context in id, and carry the case's persona/title/scenario
                    # through so the phone template can show the same persona badge + scenario
                    # framing as the console's per-case context bar.
                    copy = dict(d)
                    copy["id"] = f"{c.get('id')}_" + str(copy.get("id") or len(seq))
                    copy["persona"] = c.get("persona")
                    copy["caseTitle"] = c.get("title")
                    copy["caseScenario"] = c.get("scenario")
                    seq.append(_normalize_module_item(module_id, copy, len(seq)))
            return seq
        if module_id == "closing-quiz":
            qs = data.get("questions", []) or []
            prompts = data.get("stopVerifyReportPrompts", []) or []
            seq = [_normalize_module_item(module_id, r, i) for i, r in enumerate(qs)]
            # Append SVR prompts as additional steps
            for idx, p in enumerate(prompts):
                seq.append(_normalize_module_item(module_id, p, len(seq)))
            return seq
        if module_id == "clue-quest":
            return [_normalize_module_item(module_id, r, i) for i, r in enumerate(data.get("riddles", []))]
        if module_id == "pass-phrase":
            return [_normalize_module_item(module_id, r, i) for i, r in enumerate(data.get("rounds", []))]
        if module_id == "crossword":
            # One grid activity
            return [_normalize_module_item(module_id, {}, 0)]
    except Exception:
        return []
    return []


def _get_modules_with_counts():
    """Return 7 modules with item counts read live from content/*.json."""
    out = []
    for m in MODULE_DEFS:
        seq = _load_module_sequence(m["id"])
        # For crossword, count is 1 grid (not 18 placements)
        count = len(seq)
        # Ensure count reflects file content, not hardcoded
        out.append({"id": m["id"], "displayName": m["displayName"], "itemCount": count, "contentFile": m["content"]})
    return out


def _gen_room_code(length: int = 6) -> str:
    alphabet = string.ascii_uppercase + string.digits  # no lowercase to avoid confusion
    for _ in range(20):
        code = "".join(random.choices(alphabet, k=length))
        if code not in SESSIONS:
            return code
    # extremely unlikely collision path
    return "".join(random.choices(alphabet, k=length)) + secrets.token_hex(1).upper()


def _gen_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:8]}"


def _get_join_url(room_code: str) -> str:
    """Build absolute join URL from the actual request host (works on Render and custom domains).

    Uses Flask's request.host_url so QR/join links point to the live
    host (e.g. https://<your-app>.onrender.com) instead of a LAN IP.
    No URL is hard-coded — it is derived from the request each time, so
    swapping to a custom production domain works automatically.
    """
    try:
        # request.host_url includes scheme + host, e.g. "https://example.onrender.com/"
        # Use it directly if we are inside a request context.
        if request and request.host_url:
            base = request.host_url.rstrip("/")
            # When behind a proxy Render may set X-Forwarded-Proto; respect it
            # if the current request was forwarded as https.
            # Flask's request.host_url already respects the proxy if configured,
            # but we handle X-Forwarded-Proto manually for robustness.
            try:
                xf_proto = request.headers.get("X-Forwarded-Proto", "")
                if xf_proto and base.startswith("http://") and xf_proto == "https":
                    base = "https://" + base[len("http://"):]
            except Exception:
                pass
            return f"{base}/join/{room_code}"
    except Exception:
        pass
    # Outside request context (e.g. CLI) — fallback to relative URL; caller will
    # resolve via browser's current host.
    return f"/join/{room_code}"


def _ff_effective_fake_side(item: dict, participant_id: str | None) -> str | None:
    """Fault-finding only: deterministic per-participant slot ('A' or 'B') for the fake image.

    The console (fault-finding.js) randomizes `fakeSide` on every render (Math.random()<0.5).
    The phone path used to hardcode B-is-always-fake, which meant the position was a learnable
    fixed pattern (tap B without even looking). This derives a stable hash of (itemId,
    participantId) instead — same participant always sees the same side for a given item (so
    grading and repeated /state polls stay consistent), but different participants land on
    different sides, and there's no single global answer to memorize. Returns None for
    non-fault-finding items (no realImage/fakeImage pair) or with no participant context, in
    which case callers fall back to the item's own fixed correctOptionId.
    """
    if not item or item.get("realImage") is None or item.get("fakeImage") is None or not participant_id:
        return None
    digest = hashlib.sha256(f"{item.get('id')}:{participant_id}".encode("utf-8")).digest()
    return "A" if digest[0] % 2 == 0 else "B"


def _response_entries_for_module(bucket: dict, module_id: str | None) -> dict:
    """Filter a {participantId: entry} response bucket down to entries that actually belong to
    module_id.

    sess["responses"] is keyed by raw itemId (not module-namespaced) and deliberately survives
    re-launching a different module in the same room (see admin_launch: "launch does not wipe
    them", so a facilitator can run several modules back-to-back in one room/QR code). Every
    module's content today uses module-prefixed ids (mf-*, compare-*, phishing-link-clicked,
    ...) so there's no live collision, but nothing previously stopped two modules from reusing
    the same itemId and silently mixing each other's answers/correctness. session_respond now
    tags each new entry with the moduleId active at the moment it was recorded; this filters out
    any entry whose tag doesn't match the module being read, closing that gap for all responses
    written from here on. Entries with no tag at all (pre-dating this change) are passed through
    unfiltered rather than dropped, so already-collected event data isn't silently wiped by a
    mid-event deploy — filtering only ever removes entries we can positively prove belong to a
    different module.
    """
    if not bucket:
        return {}
    return {
        pid: entry for pid, entry in bucket.items()
        if not isinstance(entry, dict) or entry.get("moduleId") in (None, module_id)
    }


def _effective_correct_option_id(item: dict | None, participant_id: str | None = None):
    """correctOptionId as it actually applies to one participant.

    Identical to item['correctOptionId'] for every module except fault-finding, whose fake-image
    slot is randomized per participant (see _ff_effective_fake_side) rather than fixed by content
    order — grading, admin correctCount, and per-item feedback must all key off this, not the
    item's raw correctOptionId, or they'd disagree with what that participant actually saw.
    """
    if not item:
        return None
    fake_side = _ff_effective_fake_side(item, participant_id)
    if fake_side is not None:
        return fake_side
    return item.get("correctOptionId")


def _sanitize_item_for_participant(item: dict | None, active_module: str | None = None, my_answer=None, my_build=None, participant_id: str | None = None, is_submitted: bool = False) -> dict | None:
    """Return participant-safe copy of an item — no answer key, no fact/reveal text *before* submit.

    Before Submit, reveals are admin-screen-only (read aloud) — never sent to phones, so
    "fact"/"revealed"/"correctOptionId"/"isTrue" are not copied. `my_answer` decorates with
    own prior optionId and derives `myAnswerCorrect` (was THIS answer right) as immediate
    badge feedback. After Submit (`is_submitted=True`), the full `fact` (identification +
    recommendation: what was wrong + why suspicious / idealResponse / explanation) is now
    included so the participant can review per-item detail in read-only mode, mirroring the
    console's Reveal. `my_build` is pass-phrase's equivalent. `participant_id` drives
    per-participant image randomization.
    """
    if not item:
        return None
    # Sanitize options: only id and text are safe to expose — outcome/isCorrect/correct
    # must never leak to participants (see decision-room outcome leak check). Rebuild list
    # rather than passing through the stored array directly.
    sanitized_opts = []
    for o in item.get("options", []):
        try:
            sanitized_opts.append({"id": str(o.get("id", "")), "text": str(o.get("text", ""))})
        except Exception:
            pass
    safe = {
        "id": item.get("id"),
        "prompt": item.get("prompt"),
        "options": sanitized_opts,
    }
    # Pure display fields, safe to pass through as-is — none of these reveal a correct answer.
    # Only copied when present so modules that don't set them don't carry null clutter.
    for field in ("realImage", "fakeImage", "topic", "persona", "category", "caseTitle", "caseScenario", "kind",
                  "weakPassword", "weakRequirement", "deck", "maxSlots", "maxChars", "difficulty"):
        if item.get(field) is not None:
            safe[field] = item[field]
    # Hybrid after Submit: participant sees full identification + recommendation (fact) in read-only review,
    # mirroring console's Reveal. Before Submit, fact is never sent.
    if is_submitted and item.get("fact"):
        safe["fact"] = str(item.get("fact"))
        safe["revealed"] = True
    effective_correct = _effective_correct_option_id(item, participant_id)
    # Fault-finding: this participant's fake image lands in slot A instead of the content's
    # default B — swap the two image URLs so what they SEE matches what gets graded correct.
    if active_module == "fault-finding" and safe.get("realImage") is not None and effective_correct == "A":
        safe["realImage"], safe["fakeImage"] = safe.get("fakeImage"), safe.get("realImage")
    if my_answer is not None:
        safe["myAnswer"] = my_answer
        if effective_correct is not None:
            safe["myAnswerCorrect"] = (str(my_answer) == str(effective_correct))
    if my_build is not None:
        safe["myBuild"] = my_build
    return safe


# --- Pass-phrase: build-your-own-password deck + strength meter ---
# Ported from live-event/modules/pass-phrase.js's own generateWeakPassword/generateDeck/
# computeStrength — the console's real mechanic (build from a themed deck into a password
# row, watch the strength meter) rather than a rating poll. Redesigned to multi-character
# chunks (Part 2): deck is now 15 mixed CHUNKS (some 2-char syllable pairs like "Ka","Th",
# "on", some single letters, some 1-char symbols/numbers) that participants combine — not
# letter-by-letter — to assemble a password, capped by total character count (PP_MAX_CHARS)
# rather than tile count so a "Ka" tile counts as 2 characters toward the cap. Difficulty
# ramps easy→hard across 5 rounds: easy is mostly singles + a couple 2-char/helpers,
# hard has more 2-char chunks and fewer obviously-needed symbols/numbers.
PP_DECK_SIZE = 15
PP_MAX_SLOTS = 12  # legacy tile-count cap, kept for backwards compat with old content
PP_MAX_CHARS = 20  # new chunk-aware cap: total characters reached, not tile count
PP_NAMES = ["Rahul", "Priya", "Amit", "Neha", "Arjun", "Sneha", "Vikram", "Ananya", "Rohan", "Isha", "Karan", "Meera"]
PP_PLACES = ["Mumbai", "Delhi", "Chennai", "Kolkata", "Goa", "Pune", "Jaipur", "Kochi", "Hyderabad"]
PP_YEARS = ["1998", "1999", "2000", "2001", "2002", "2003", "1995", "1990", "1992"]
PP_PHRASE_WORDS = ["Ocean", "Voyage", "Anchor", "Harbor", "Bridge", "Compass", "Horizon", "Voyager", "Marina", "Delta"]
PP_UPPER_POOL = [chr(c) for c in range(65, 91)]
PP_LOWER_POOL = [chr(c) for c in range(97, 123)]
PP_NUM_POOL = [chr(c) for c in range(48, 58)]
PP_SYM_POOL = list("!@#$%^&*-_+=?~<>")
PP_CHUNK_TWO_POOL = ["Ka","Ri","Th","On","An","Re","Co","Ma","Be","Su","Un","Ex","Mi","Tr","Ch","Sh","Pr","St","Li","En","Or","Al","El","Ar","on","th","an","er","in"]


def _pp_generate_weak_password(difficulty: str) -> str:
    name = random.choice(PP_NAMES)
    place = random.choice(PP_PLACES)
    year = random.choice(PP_YEARS)
    if difficulty == "easy":
        r = random.random()
        if r < 0.5:
            return name.lower() + year[-2:]
        elif r < 0.75:
            return place.lower() + str(random.randint(100, 999))
        else:
            return name.lower() + str(random.randint(100, 999))
    elif difficulty == "medium":
        base = name + place + year[-2:]
        if random.random() < 0.3:
            base = base[0].lower() + base[1:]
        return base
    else:
        sep = random.choice(["_", "-", "@", "#"])
        tail = year if random.random() < 0.5 else year[-2:]
        hard = name + sep + place + tail
        if random.random() < 0.3:
            hard += random.choice(PP_SYM_POOL[:6])
        return hard


def _pp_rand_chars(pool: list, count: int, allow_dup: bool) -> list:
    if count <= 0:
        return []
    if not allow_dup:
        shuffled_pool = pool[:]
        random.shuffle(shuffled_pool)
        return shuffled_pool[:count]
    return [random.choice(pool) for _ in range(count)]


def _pp_rand_chunks(pool: list, count: int, allow_dup: bool) -> list:
    """Same as _pp_rand_chars but for the 2-char chunk pool."""
    if count <= 0:
        return []
    if not allow_dup:
        shuffled_pool = pool[:]
        random.shuffle(shuffled_pool)
        return shuffled_pool[:count]
    return [random.choice(pool) for _ in range(count)]


def _pp_generate_deck(difficulty: str, weak: str) -> list:
    """Mixed-chunk deck: 2-char syllable pairs + singles + symbols/numbers.

    Easy: mostly singles plus a couple easy 2-char/symbol chunks — straightforward.
    Hard: more 2-char chunks and fewer obviously-needed symbols/numbers.
    Total deck size is PP_DECK_SIZE (15) chunks, each chunk is 1 or 2 characters.
    Strength still scores the concatenated string, so deck composition controls
    how deliberately a participant must combine chunks to reach Strong/Very Strong.
    """
    has_upper = bool(re.search(r"[A-Z]", weak))
    has_num = bool(re.search(r"[0-9]", weak))
    has_sym = bool(re.search(r"[^A-Za-z0-9]", weak))
    missing_upper, missing_num, missing_sym = not has_upper, not has_num, not has_sym
    if difficulty == "easy":
        two_count = 2
        upper_count = 3 if missing_upper else 2
        sym_count = 3 if missing_sym else 2
        num_count = 2
        allow_dup = False
    elif difficulty == "medium":
        two_count = 4
        upper_count = 2
        sym_count = 2
        num_count = 2
        allow_dup = random.random() < 0.2
    else:  # hard
        two_count = 6
        upper_count = 1
        if missing_sym and random.random() < 0.5:
            upper_count = 2
        sym_count = 1
        if missing_sym and random.random() < 0.5:
            sym_count = 2
        num_count = 1
        if missing_num and random.random() < 0.4:
            num_count = 2
        allow_dup = True

    deck = []
    deck += _pp_rand_chunks(PP_CHUNK_TWO_POOL, two_count, allow_dup)
    deck += _pp_rand_chars(PP_UPPER_POOL, upper_count, allow_dup)
    deck += _pp_rand_chars(PP_SYM_POOL, sym_count, allow_dup)
    deck += _pp_rand_chars(PP_NUM_POOL, num_count, allow_dup)
    lower_needed = PP_DECK_SIZE - len(deck)
    lower_needed = max(2, lower_needed)

    if difficulty == "hard":
        weak_lowers = [c for c in weak if c.islower()]
        lowers = []
        for _ in range(lower_needed):
            if weak_lowers and random.random() < 0.55:
                lowers.append(random.choice(weak_lowers))
            else:
                lowers.append(random.choice(PP_LOWER_POOL))
        # decoy dupes to make choices less obvious
        for d in range(2):
            if deck and lowers and random.random() < 0.6:
                dup = random.choice(deck)
                lowers[d % len(lowers)] = dup
        deck += lowers
    else:
        deck += _pp_rand_chars(PP_LOWER_POOL, lower_needed, allow_dup)

    random.shuffle(deck)
    deck = deck[:PP_DECK_SIZE]
    while len(deck) < PP_DECK_SIZE:
        deck.append(random.choice(PP_LOWER_POOL))

    # Guarantee at least one of each missing type is present for easy/medium
    if difficulty != "hard":
        # check_helpers: need to consider that 2-char chunks may contain upper/lower/symbol
        flat = "".join(deck)
        if missing_upper and not any(c.isupper() for c in flat):
            deck[0] = random.choice(PP_UPPER_POOL)
        if missing_sym and not any(not c.isalnum() for c in flat):
            deck[1] = random.choice(PP_SYM_POOL)
        if missing_num and not any(c.isdigit() for c in flat):
            deck[2] = random.choice(PP_NUM_POOL)
    return deck


def _pp_compute_strength(pw: str, weak: str) -> dict:
    """Direct port of computeStrength() in pass-phrase.js — same scoring, same thresholds."""
    has_upper = bool(re.search(r"[A-Z]", pw))
    has_lower = bool(re.search(r"[a-z]", pw))
    has_number = bool(re.search(r"[0-9]", pw))
    has_special = bool(re.search(r"[^A-Za-z0-9]", pw))
    score = 0
    if len(pw) >= 12:
        score += 25
    elif len(pw) >= 8:
        score += 10
    if len(pw) >= 16:
        score += 10
    if has_upper:
        score += 15
    if has_lower:
        score += 15
    if has_number:
        score += 15
    if has_special:
        score += 15
    if has_upper and has_lower and has_number and has_special and len(pw) >= 12:
        score += 5
    if weak:
        norm_pw = pw.lower()
        norm_weak = weak.lower()
        if norm_pw == norm_weak:
            score = max(0, score - 30)
        elif norm_weak in norm_pw or norm_pw in norm_weak:
            score = max(0, score - 15)
        if len(pw) - len(weak) <= 2 and norm_weak[:4] in norm_pw:
            score = max(0, score - 10)
    if re.search(r"(.)\1{2,}", pw):
        score = max(0, score - 10)
    score = min(100, max(0, score))
    charset = 0
    if has_lower:
        charset += 26
    if has_upper:
        charset += 26
    if has_number:
        charset += 10
    if has_special:
        charset += 12
    crack = "—"
    if len(pw) > 0 and charset > 0:
        entropy = len(pw) * math.log2(charset)
        guesses = 2 ** entropy
        seconds = guesses / 1e9
        if seconds < 1:
            crack = "< 1 second"
        elif seconds < 60:
            crack = f"{round(seconds)} seconds"
        elif seconds < 3600:
            crack = f"{round(seconds / 60)} minutes"
        elif seconds < 86400:
            crack = f"{round(seconds / 3600)} hours"
        elif seconds < 2592000:
            crack = f"{round(seconds / 86400)} days"
        elif seconds < 31536000:
            crack = f"{round(seconds / 2592000)} months"
        elif seconds < 315360000:
            crack = f"{round(seconds / 31536000)} years"
        else:
            crack = "centuries"
    if len(pw) == 0 or score < 40:
        label, level, color = "Weak", "weak", "#ef4444"
    elif score < 60:
        label, level, color = "Fair", "fair", "#f59e0b"
    elif score < 80:
        label, level, color = "Strong", "strong", "#10b981"
    else:
        label, level, color = "Very Strong", "very-strong", "#065f46"
    return {"score": score, "label": label, "level": level, "color": color, "crack": crack}


def _normalize_options(options) -> list:
    """Accept [str] or [{id,text}] or [{id,label}] and normalize to [{id,text}]."""
    norm = []
    for idx, opt in enumerate(options):
        if isinstance(opt, str):
            norm.append({"id": f"opt{idx}", "text": opt})
        elif isinstance(opt, dict):
            oid = opt.get("id") or opt.get("optionId") or f"opt{idx}"
            text = opt.get("text") or opt.get("label") or opt.get("value") or str(opt.get("id", ""))
            # strip reveal/correct flags for storage? keep isCorrect for admin but not participant
            entry = {"id": str(oid), "text": str(text)}
            # preserve isCorrect/correct for results but not exposed via state
            if "isCorrect" in opt:
                entry["isCorrect"] = bool(opt["isCorrect"])
            if "correct" in opt:
                entry["isCorrect"] = bool(opt["correct"])
            if "outcome" in opt:
                entry["outcome"] = str(opt["outcome"])
            norm.append(entry)
        else:
            norm.append({"id": f"opt{idx}", "text": str(opt)})
    return norm


def admin_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get("is_admin"):
            return jsonify({"error": "unauthorized", "message": "admin login required"}), 401
        return f(*args, **kwargs)
    return wrapper


@app.before_request
def _gate_admin_routes():
    # Gate all /api/admin/* except login itself
    if request.path.startswith("/api/admin/"):
        if request.path == "/api/admin/login":
            return None
        if request.method == "OPTIONS":
            # Allow OPTIONS for CORS preflight if needed
            return None
        if not session.get("is_admin"):
            return jsonify({"error": "unauthorized"}), 401
        # Idle timeout: separate from the 12h absolute cookie lifetime (PERMANENT_SESSION_LIFETIME
        # above) — logs an unattended admin session out after a stretch of no admin API activity,
        # rather than staying valid for the full 12h regardless of use, now that this dashboard is
        # reachable on the open internet and not just venue WiFi.
        now = datetime.now(timezone.utc)
        last_active_raw = session.get("last_admin_activity")
        if last_active_raw:
            try:
                last_active = datetime.fromisoformat(last_active_raw)
            except Exception:
                last_active = None
            if last_active and (now - last_active) > ADMIN_IDLE_TIMEOUT:
                session.clear()
                return jsonify({"error": "session expired", "message": "logged out after inactivity — please log in again"}), 401
        session["last_admin_activity"] = now.isoformat()
        # CSRF: session cookie + same-origin fetch alone isn't enough once this is reachable on
        # the open internet — require the per-login token (see /api/admin/login, /api/admin/check)
        # as a header on every mutating admin request. Safe (GET/HEAD) requests are exempt.
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            token = request.headers.get("X-CSRF-Token") or ""
            expected = session.get("csrf_token") or ""
            if not token or not expected or not secrets.compare_digest(str(token), str(expected)):
                return jsonify({"error": "invalid csrf token"}), 403


def load_deck_file_list():
    """Extract slide filenames from deck.js's SLIDES array."""
    if not DECK_JS.exists():
        return []
    text = DECK_JS.read_text(encoding="utf-8")
    match = re.search(r"var\s+SLIDES\s*=\s*\[(.*?)\]\s*;", text, re.DOTALL)
    if not match:
        return []
    return SLIDE_ENTRY_RE.findall(match.group(1))


def check_deck_alignment():
    files = load_deck_file_list()
    if not files:
        print("WARNING: could not read SLIDES array from scripts/deck.js", file=sys.stderr)
        return
    missing = [f for f in files if not (SLIDES_DIR / f).exists()]
    print(f"deck.js declares {len(files)} slide(s): {files[0]} .. {files[-1]}")
    if missing:
        print(f"WARNING: deck.js references file(s) missing from slides/: {missing}", file=sys.stderr)
    else:
        print("All slides referenced in deck.js exist on disk. OK.")


@app.route("/")
def index():
    if not INDEX_HTML.exists():
        abort(404)
    return send_from_directory(ROOT, "index.html")


@app.route("/scripts/<path:filename>")
def scripts(filename):
    return send_from_directory(SCRIPTS_DIR, filename)


@app.route("/styles/<path:filename>")
def styles(filename):
    return send_from_directory(STYLES_DIR, filename)


@app.route("/assets/<path:filename>")
def assets(filename):
    return send_from_directory(ASSETS_DIR, filename)


@app.route("/slides/<path:filename>")
def slides(filename):
    return send_from_directory(SLIDES_DIR, filename)


@app.route("/live-event/")
def live_event_index():
    # Standalone presentation console is now admin-only (see docs/APPLICATION_STATE.md — this
    # reverses the earlier "zero auth dependency" behavior). Unauthenticated visitors are
    # redirected to /admin's login form rather than seeing the module menu.
    if not session.get("is_admin"):
        return redirect("/admin")
    return send_from_directory(LIVE_EVENT_DIR, "index.html")


@app.route("/live-event/<path:filename>")
def live_event(filename):
    # Gate only the console's own HTML pages (index.html above + the 9 module pages here) —
    # NOT the shared assets under this same path (console.css, console.js, content/*.json,
    # assets/*), which the phone-synced /join/<code> page also depends on (console.css's own
    # @import chain, fault-finding's real email images) and participants are never
    # admin-authenticated. Gating the whole path would silently break every participant's
    # phone view, not just the standalone console.
    if filename.endswith(".html") and not session.get("is_admin"):
        return redirect("/admin")
    return send_from_directory(LIVE_EVENT_DIR, filename)


# Public, unauthenticated health check — used by the admin dashboard's own status display
# and by an external uptime pinger. Render's free/hobby tier sleeps a dyno after ~15min idle;
# this app does NOT self-ping (that would fight Render's own sleep policy and can mask real
# outages) — if you need the dyno kept awake during a live event, point an external uptime
# service (e.g. UptimeRobot, cron-job.org) at GET /health on an interval shorter than the
# sleep timeout.
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "sessionsLoaded": len(SESSIONS)})


# --- Admin dashboard page (new, behind admin login via API gate) ---
# Serves dashboard HTML at /admin, /admin/, /admin/dashboard.
# The HTML itself is public so the login form can be shown; all data
# is gated via /api/admin/* session cookie. Page QR/join links use
# request.host_url so they resolve to the live host
# (e.g. https://<app>.onrender.com or any custom domain) without hardcoding.
@app.route("/admin")
@app.route("/admin/")
@app.route("/admin/dashboard")
def admin_dashboard_page():
    dashboard = ADMIN_DIR / "dashboard.html"
    if not dashboard.exists():
        abort(404)
    return send_from_directory(ADMIN_DIR, "dashboard.html")


@app.route("/admin/dashboard.html")
def admin_dashboard_html():
    dashboard = ADMIN_DIR / "dashboard.html"
    if not dashboard.exists():
        abort(404)
    return send_from_directory(ADMIN_DIR, "dashboard.html")


# ============================================================
# ADDITIVE: Admin auth + live room/session store
# ============================================================

@app.route("/api/admin/login", methods=["POST"])
def admin_login():
    data = request.get_json(silent=True) or {}
    # Support new .env flow {username,password} and legacy {password} for backwards compat
    password = data.get("password") or data.get("pass") or data.get("adminPassword") or request.form.get("password") or ""
    username = data.get("username") or data.get("user") or data.get("adminUsername") or request.form.get("username") or ""
    # Also allow query param for quick curl
    if not password:
        password = request.args.get("password") or ""
    if not username:
        username = request.args.get("username") or request.args.get("user") or ""
    if not password:
        return jsonify({"error": "password required"}), 400
    # If username provided (new flow), check both; otherwise legacy password-only check
    if username:
        ok_user = secrets.compare_digest(str(username), str(ADMIN_USERNAME))
        ok_pass = secrets.compare_digest(str(password), str(ADMIN_PASSWORD))
        if not (ok_user and ok_pass):
            return jsonify({"error": "invalid credentials"}), 401
    else:
        ok = secrets.compare_digest(str(password), str(ADMIN_PASSWORD))
        if not ok:
            return jsonify({"error": "invalid password"}), 401
    session["is_admin"] = True
    session.permanent = True
    session["last_admin_activity"] = datetime.now(timezone.utc).isoformat()
    # Fresh CSRF token per login — required as X-CSRF-Token on every mutating /api/admin/*
    # request (see _gate_admin_routes). Returned here so the dashboard can attach it going forward.
    csrf_token = secrets.token_urlsafe(32)
    session["csrf_token"] = csrf_token
    return jsonify({"ok": True, "message": "logged in", "username": ADMIN_USERNAME, "csrfToken": csrf_token})


@app.route("/api/admin/logout", methods=["POST", "GET"])
def admin_logout():
    session.clear()
    return jsonify({"ok": True, "message": "logged out"})


@app.route("/api/admin/check", methods=["GET"])
def admin_check():
    is_admin = bool(session.get("is_admin"))
    out = {"isAdmin": is_admin}
    if is_admin:
        # A session created before CSRF support won't have a token yet — issue one now so an
        # already-logged-in admin (cookie still valid) doesn't need to re-login to get one.
        if not session.get("csrf_token"):
            session["csrf_token"] = secrets.token_urlsafe(32)
        out["csrfToken"] = session["csrf_token"]
    return jsonify(out)


@app.route("/api/session/create", methods=["POST"])
@admin_required
@persist_after
def session_create():
    code = _gen_room_code()
    now = datetime.now(timezone.utc).isoformat()
    SESSIONS[code] = {
        "roomCode": code,
        "createdAt": now,
        "participants": {},  # id -> name
        "participantMeta": {},  # id -> {name, joinedAt}
        "activeModule": None,
        "state": None,  # lobby|running|complete
        "moduleSequence": [],
        "currentItemIndex": None,
        "activeItem": None,
        "responses": {},  # itemId -> {participantId: optionId}
        "crosswordProgress": {},  # participantId -> {filledCount, totalCount, updatedAt}
        "passphraseBuilds": {},  # participantId -> {roundId: {builtPassword, strength, updatedAt}}
        "submissions": {},  # participantId -> { moduleId: submittedAt_iso }
    }
    join_url = _get_join_url(code)
    return jsonify({"roomCode": code, "joinUrl": join_url, "join_url": join_url})


@app.route("/api/session/<code>/qr", methods=["GET"])
def session_qr(code):
    code = code.strip().upper()
    sess = SESSIONS.get(code)
    if not sess:
        return jsonify({"error": "room not found"}), 404
    join_url = _get_join_url(code)
    # Try qrcode, else Pillow fallback
    png_bytes = None
    try:
        import qrcode
        qr = qrcode.QRCode(version=1, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=10, border=4)
        qr.add_data(join_url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        png_bytes = buf.getvalue()
    except Exception as e:
        # Pillow fallback: render text image
        try:
            from PIL import Image, ImageDraw, ImageFont
            W, H = 600, 600
            img = Image.new("RGB", (W, H), "white")
            draw = ImageDraw.Draw(img)
            # Try to load a font
            try:
                font_big = ImageFont.load_default()
                font_small = ImageFont.load_default()
            except Exception:
                font_big = None
                font_small = None
            # Simple placeholder with border
            draw.rectangle([10, 10, W-10, H-10], outline="black", width=4)
            # Center text: room code + URL
            txt1 = f"ROOM: {code}"
            txt2 = join_url
            txt3 = "QR library missing — show URL"
            # Draw centered approximations
            draw.text((W//2, H//2 - 40), txt1, fill="black", font=font_big, anchor="mm")
            draw.text((W//2, H//2 + 10), txt2, fill="black", font=font_small, anchor="mm")
            draw.text((W//2, H//2 + 50), txt3, fill="gray", font=font_small, anchor="mm")
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            png_bytes = buf.getvalue()
        except Exception as e2:
            return jsonify({"error": "qr generation failed", "detail": str(e), "fallback_error": str(e2)}), 500
    if not png_bytes:
        return jsonify({"error": "qr generation failed"}), 500
    return Response(png_bytes, mimetype="image/png", headers={"Cache-Control": "no-store"})


@app.route("/join/<code>", methods=["GET"])
def join_page(code):
    code = code.strip().upper()
    sess = SESSIONS.get(code)
    if not sess:
        html_bad = """<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/><title>Room __ROOM_CODE__ not found — Synergy</title>
<style>body{font-family:system-ui,-apple-system,Barlow,sans-serif;background:#f8fafc;color:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px} .card{background:white;border:1px solid #e2e8f0;border-radius:16px;padding:24px;max-width:420px;width:100%;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,0.08)} h1{font-size:1.25rem;margin:0 0 8px} p{color:#64748b;margin:0 0 16px;line-height:1.5} a{color:#0891b2;text-decoration:none;font-weight:700} .room{font-family:monospace;background:#e0f2fe;color:#0c4a6e;padding:4px 8px;border-radius:6px;letter-spacing:1px}</style>
</head><body><div class="card"><h1>Room <span class="room">__ROOM_CODE__</span> not found</h1><p>This room code doesn't exist or has been closed. Double-check the code or ask the facilitator for a fresh QR.</p><p><a href="/">← Go home</a></p><p style="font-size:12px;color:#94a3b8;margin-top:12px">Synergy Cyber Security Awareness Month</p></div></body></html>"""
        html_bad = html_bad.replace("__ROOM_CODE__", code)
        return Response(html_bad, status=404, mimetype="text/html")
    html_template = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<title>Join __ROOM_CODE__ — Synergy Cyber Security Awareness Month</title>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Barlow:wght@400;600;700;800&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet"/>
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" rel="stylesheet"/>
<!-- Reuses the same component classes as the facilitator console (mf-card, dr-option,
     cq-riddle-card, ff-compare-panel, etc.) so a phone and the big screen showing the same
     activity read as the same product — see the phone-only overrides at the end of this block. -->
<link href="/live-event/console.css" rel="stylesheet"/>
<style>
*{box-sizing:border-box} html,body{height:100%}
body{margin:0;font-family:'Barlow',system-ui,-apple-system,sans-serif;background:#f1f5f9;color:#0f172a;min-height:100dvh;display:flex;flex-direction:column}
/* Header reuses console.css's own .le-topbar/.le-brand classes verbatim (same SYN.png/AFT.png
   logo files, same colors/borders/blur) so the phone header matches the admin dashboard/console
   exactly — but .le-topbar's own sizing (clamp(42px,4.2vw,64px) logos, a 5-word subtitle with
   no wrap guard) was tuned for a 1920x1080 display that never needs to fit a 375-430px phone
   width; left as-is it overflows the viewport instead of wrapping. These overrides only touch
   sizing/wrapping, never color/border/shadow, so the visual TREATMENT still matches — it just
   also fits. */
.header{position:sticky;top:0;z-index:10;flex-wrap:wrap;row-gap:8px}
.header .le-brand img{height:32px}
.header .le-brand-div{height:24px}
.header .le-brand-text{font-size:13px}
.header .le-brand-text small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:44vw}
.header .le-topbar-right{gap:8px}
.header .room{font-family:'Space Mono',monospace;font-weight:800;font-size:12px;background:#0f172a;color:#e0f2fe;padding:6px 10px;border-radius:999px;letter-spacing:1px}
.header .count{font-family:'Space Mono',monospace;font-size:12px;color:#64748b;background:#f1f5f9;border:1px solid #e2e8f0;padding:6px 10px;border-radius:999px}
.main{flex:1;display:flex;flex-direction:column;align-items:center;padding:16px;gap:16px;max-width:480px;width:100%;margin:0 auto}
.card{background:white;border:1px solid #e2e8f0;border-radius:16px;padding:20px;width:100%;box-shadow:0 1px 3px rgba(0,0,0,0.06)}
.card h1{font-size:1.35rem;margin:0 0 8px;line-height:1.2}
.card h2{font-size:1.1rem;margin:0 0 12px}
.card p{color:#475569;margin:0 0 14px;line-height:1.5;font-size:14px}
.hidden{display:none !important}
.input{width:100%;padding:14px 14px;border:1px solid #cbd5e1;border-radius:12px;font-size:16px;background:white}
.input:focus{outline:2px solid #06b6d4;outline-offset:2px;border-color:#06b6d4}
.btn{width:100%;padding:14px 16px;border-radius:12px;border:0;background:#06b6d4;color:white;font-weight:800;font-size:16px;min-height:52px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px}
.btn:active{transform:scale(0.99)}
.btn:disabled{opacity:0.5;cursor:not-allowed}
.btn.secondary{background:white;color:#0f172a;border:1px solid #cbd5e1}
.btn.secondary:active{background:#f8fafc}
.ok{background:#ecfdf5;border:1px solid #6ee7b7;color:#065f46;padding:12px;border-radius:12px;margin-top:12px;font-size:14px;word-break:break-word}
.err{background:#fef2f2;border:1px solid #fca5a5;color:#7f1d1d;padding:12px;border-radius:12px;margin-top:12px;font-size:14px}
.badge{font-family:'Space Mono',monospace;font-size:11px;font-weight:800;letter-spacing:0.8px;text-transform:uppercase;padding:6px 10px;border-radius:999px;background:#f1f5f9;border:1px solid #e2e8f0;color:#475569;display:inline-flex;align-items:center;gap:6px}
/* Shared small context tag — who/what a scenario is about (persona) or its subject category
   (myth-vs-fact's topic). One styled class reused everywhere this pattern appears, instead of
   each render function inventing its own (unstyled) class name. */
.persona-tag{font-family:'Space Mono',monospace;font-size:11px;font-weight:800;letter-spacing:0.6px;text-transform:uppercase;padding:5px 10px;border-radius:999px;background:#e0f2fe;border:1px solid #bae6fd;color:#075985;display:inline-flex;align-items:center;gap:6px;margin-bottom:8px}
.badge.live{background:#fef9c3;border-color:#fde68a;color:#854d0e}
.waiting-icon{width:56px;height:56px;border-radius:50%;background:#e0f2fe;color:#0c4a6e;display:flex;align-items:center;justify-content:center;font-size:24px;margin:0 auto 12px}
.prompt{font-size:18px;font-weight:800;line-height:1.35;margin:0 0 16px;color:#0f172a}
.options{display:grid;gap:12px}
.option-btn{width:100%;padding:16px 14px;border-radius:12px;border:2px solid #e2e8f0;background:white;color:#0f172a;font-weight:700;font-size:16px;min-height:56px;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;line-height:1.3}
.option-btn:active{transform:scale(0.985)}
.option-btn.selected{background:#0f172a;color:white;border-color:#0f172a}
.option-btn:disabled{cursor:default;opacity:1}
.option-btn .opt-num{width:32px;height:32px;border-radius:50%;background:#0f172a;color:white;display:flex;align-items:center;justify-content:center;font-family:'Space Mono',monospace;font-size:13px;font-weight:800;flex-shrink:0}
.option-btn.selected .opt-num{background:white;color:#0f172a}
.fact{margin-top:16px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:14px;color:#78350f;line-height:1.5}
.fact strong{color:#92400e}
.locked{margin-top:14px;background:#ecfdf5;border:1px solid #6ee7b7;color:#065f46;padding:12px;border-radius:12px;text-align:center;font-weight:700}
.reconnect{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#0f172a;color:white;padding:10px 14px;border-radius:999px;font-family:'Space Mono',monospace;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:50}
/* Crossword compact mobile */
.cw-wrap{width:100%}
.cw-status{font-family:'Space Mono',monospace;font-size:12px;color:#64748b;text-align:center;margin:8px 0 10px}
.cw-grid-wrap{background:white;border:1px solid #e2e8f0;border-radius:12px;padding:8px;overflow:auto;-webkit-overflow-scrolling:touch}
.cw-grid{display:grid;gap:1px;background:#cbd5e1;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;min-width:280px}
.cw-cell{position:relative;background:white;aspect-ratio:1;display:flex;align-items:center;justify-content:center;min-width:0}
.cw-cell.cw-block{background:#1e293b}
.cw-num{position:absolute;top:2px;left:3px;font-family:'Space Mono',monospace;font-size:7px;font-weight:800;color:#475569;line-height:1}
.cw-input{width:100%;height:100%;border:0;text-align:center;font-weight:800;font-size:16px;text-transform:uppercase;background:transparent;outline:none;padding:0;touch-action:manipulation}
.cw-input:focus{background:#e0f2fe}
.cw-cell.active-cell{background:#e0f2fe}
.cw-cell.active-word{background:#f0f9ff}
.cw-cell.correct{background:#ecfdf5}
.cw-cell.incorrect{background:#fef2f2}
.cw-hint-btn{margin-left:8px;font-family:Space Mono,monospace;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:#0891b2;background:rgba(6,182,212,0.08);border:1px solid rgba(6,182,212,0.25);border-radius:999px;padding:3px 9px;cursor:pointer;touch-action:manipulation}
.cw-hint-btn:disabled{opacity:0.5;cursor:default}
.cw-hint-text{display:block;margin-top:4px;font-family:Space Mono,monospace;font-size:11px;font-style:italic;color:#b45309}
.cw-clues{display:grid;gap:16px;margin-top:14px}
.cw-clue-col h3{font-size:13px;font-weight:800;letter-spacing:0.8px;text-transform:uppercase;color:#334155;margin:0 0 8px}
.cw-clue-list{list-style:none;padding:0;margin:0;display:grid;gap:8px}
.cw-clue-list li{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;font-size:13px;line-height:1.4;cursor:pointer}
.cw-clue-list li.active{background:#e0f2fe;border-color:#06b6d4}
.cw-clue-list li.solved{background:#ecfdf5;border-color:#6ee7b7}
.cw-clue-num{font-family:'Space Mono',monospace;font-weight:800;color:#0c4a6e;margin-right:6px}
@media (max-width:375px){ .main{padding:12px} .card{padding:16px} .prompt{font-size:17px} .option-btn{font-size:15px;min-height:52px;padding:14px 12px} }
/* .cw-input stays at 16px at every width (not shrunk here) — an <input> below 16px triggers
   an automatic page zoom on focus in mobile Safari; the grid cells are already a fixed 32px
   regardless of viewport (see cwRenderGrid), so 16px text fits comfortably at every width. */

/* ============================================================
   Self-paced activity screen — reuses console.css's own component
   classes (imported above) for each module's real visual template;
   this block only adds the phone-specific layout/interaction pieces
   that don't exist on the (desktop, narrated-not-tapped) console:
   stacking fault-finding's side-by-side cards, tap affordances,
   and small nav/progress chrome around whichever template is mounted.
   ============================================================ */
.act-topline{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.act-progress-badge{margin-left:auto}
#actMount{display:flex;flex-direction:column;gap:14px}
/* Reused console text classes (.cq-riddle-text, .dr-prompt, .qz-question, .mf-myth, etc.)
   were never built to wrap an unbroken long token — a desktop-width console line has plenty
   of room, but content that includes something like an email address with no hyphen (e.g.
   clue-quest's "hr@synergymarinegroup.com") has nowhere to break on a 375px phone and pushes
   the whole card past the viewport edge. Force-wrap anywhere inside the mounted template. */
#actMount, #actMount *{overflow-wrap:anywhere}
.act-nav{display:flex;gap:10px;margin-top:16px}
.act-nav .btn{flex:1}
.act-nav .btn:disabled{opacity:0.35}

/* Touch pass: every tappable surface gets touch-action:manipulation (kills the ~300ms tap
   delay some mobile browsers impose and disables double-tap-to-zoom on fast double-taps —
   without this, a quick double-tap on a card can be interpreted as a zoom gesture instead of
   two clicks) and an explicit :active press state, since touch devices never trigger :hover —
   without a defined :active, a tap would show zero visual feedback until the network
   round-trip completes and .picked lands. Reused console.css classes (dr-option, qz-choice,
   cq-option) only ever defined :hover for the desktop console's mouse use, so they needed
   this most.  */
.option-btn, .ff-compare-panel, .dr-option, .qz-choice, .cq-option,
.pp-tile[data-slot-idx], .pp-slot-empty, .pp-deck-tile, .pp-tile.chunk-tile, .pp-deck-tile.chunk-tile,
.act-nav .btn, .btn, .cw-clue-list li, .feedback-badge{
  touch-action: manipulation;
}
.ff-compare-panel:active:not(:disabled){ transform: scale(0.985); }
.dr-option:active:not(:disabled){ background: rgba(6,182,212,0.10) !important; }
.qz-choice:active{ background: rgba(6,182,212,0.10) !important; }
.cq-option:active{ background: rgba(6,182,212,0.06) !important; }
.pp-tile[data-slot-idx]:active, .pp-deck-tile:not(:disabled):active{ transform: scale(0.94); }
/* Feedback badges are non-interactive educational feedback per card (correct/not-quite) —
   they appear below the options after an answer, never overlay the options, and must not
   block or delay the next tap. They have no pointer events that could intercept a tap on the
   Prev/Next chrome below, and the 1400ms auto-advance pause is intentional for reading, not
   a touch delay — Prev remains immediately tappable to go back. */
.feedback-badge{ pointer-events: none; touch-action: manipulation; }
.pp-tile.chunk-tile, .pp-deck-tile.chunk-tile{
  /* 2-char chunks like "Ka","Th","on" are slightly wider than single chars but still
     comfortably tappable at 375px — flex-wrap keeps the 15-chunk deck from overflowing. */
  min-width: clamp(56px, 6.2vw, 78px);
}

/* Fault-finding: console's ff-compare-row is a side-by-side flex row with no mobile
   breakpoint — force a vertical stack, and turn each panel into a real tappable button
   (the console never needs a click target here since it's narrated, not answered). */
.ff-compare-row{flex-direction:column !important}
button.ff-compare-panel{all:unset;box-sizing:border-box;display:block;width:100%;cursor:pointer;position:relative;touch-action:manipulation}
.ff-compare-panel img{display:block;width:100%;height:auto;border-radius:0 0 8px 8px}
.ff-compare-panel .ff-tap-hint{text-align:center;font-family:'Space Mono',monospace;font-size:11px;font-weight:800;letter-spacing:0.5px;text-transform:uppercase;color:var(--cyan-dark,#0891b2);padding:8px;background:rgba(6,182,212,0.08)}
.ff-compare-panel.picked{border-color:var(--cyan,#06b6d4) !important;box-shadow:0 0 0 3px rgba(6,182,212,0.25)}
.ff-compare-panel.picked .ff-tap-hint{background:var(--cyan,#06b6d4);color:#fff}
.ff-compare-panel:disabled{cursor:default}

/* Myth-vs-fact: real mf-card look, plain proven tap-target buttons for the True/False vote
   (console has no binary choice UI here — it's a single reveal button, not applicable). */
.mf-card .options{margin-top:14px}

/* Per-item correct/wrong feedback (renderCorrectFeedback) — educational feedback on THIS
   answer only, no running score anywhere on the participant page (see docs). */
.feedback-badge{margin-top:14px;padding:12px 14px;border-radius:12px;font-weight:800;font-size:14px;display:flex;align-items:center;gap:10px;text-align:left}
.feedback-badge.correct{background:#ecfdf5;border:1px solid #6ee7b7;color:#065f46}
.feedback-badge.incorrect{background:#fef2f2;border:1px solid #fca5a5;color:#7f1d1d}
.feedback-badge i{font-size:16px}

/* Pass-phrase: real weak-password framing, live strength meter, and the actual deck/slot
   build interaction (tap-to-place, not drag — touch drag was already deemed unreliable).
   .pp-tile/.pp-deck/.pp-deck-tile/.pp-tiles are the console's own classes (console.css); only
   the empty-slot placeholder and the "selected" state are new — the console's own build row
   starts empty and only ever shows filled tiles (no pre-drawn empty slots), and it has no
   tap-to-select state since its click handler places a tile immediately on tap. */
.pp-section-label{margin-top:4px;font-family:'Space Mono',monospace;font-size:12px;font-weight:800;letter-spacing:0.5px;text-transform:uppercase;color:#475569;display:flex;align-items:center;gap:6px}
.pp-section-label span{margin-left:auto;color:#94a3b8;text-transform:none;letter-spacing:0}
button.pp-tile, button.pp-deck-tile{all:unset;box-sizing:border-box}
.pp-slot-empty{box-sizing:border-box;width:clamp(48px,5.4vw,72px);height:clamp(48px,5.4vw,72px);border:2px dashed #cbd5e1;border-radius:10px;cursor:pointer}
.pp-deck-tile.selected{border-color:var(--cyan,#06b6d4) !important;box-shadow:0 0 0 3px rgba(6,182,212,0.3);transform:translateY(-2px)}
.pp-deck-tile:disabled{cursor:not-allowed}

/* Decision-room / clue-quest / closing-quiz already collapse to a single column on their own
   (dr-options is always column; cq-options/qz-choices auto-fit or media-query to 1 col under
   1100px) — no stacking override needed, just link the stylesheet above. Console.css only
   styles these as "correct"/"incorrect" outcome states (there's no participant scoring here),
   so a neutral "picked" state — distinct from any right/wrong color — is added here. */
.dr-option.picked{background:rgba(6,182,212,0.16) !important;border-color:var(--cyan,#06b6d4) !important;box-shadow:0 0 18px rgba(6,182,212,0.25)}
.dr-option.picked .dr-opt-letter{color:var(--cyan-light,#67e8f9) !important}
.qz-choice{cursor:pointer}
.qz-choice.picked{border-color:var(--cyan,#06b6d4) !important;background:rgba(6,182,212,0.12) !important}
.qz-choice.picked .qz-letter{color:var(--cyan-dark,#0891b2) !important}
.cq-option{cursor:pointer}
.cq-option.picked{border-color:var(--cyan,#06b6d4) !important;background:rgba(6,182,212,0.08) !important;color:var(--navy,#001a4d) !important}
.cq-option.picked .cq-opt-num{background:var(--cyan,#06b6d4) !important}
</style>
</head>
<body>
<header class="header le-topbar">
  <div class="le-brand">
    <img src="/assets/SYN.png" alt="Synergy Marine Group"/>
    <div class="le-brand-div"></div>
    <img src="/assets/AFT.png" alt="AFT"/>
  </div>
  <div class="le-brand-div"></div>
  <div class="le-brand-text">
    SYNERGY CYBER
    <small><span class="le-dot" style="display:inline-block;"></span> Synergy Cyber Security Awareness Month</small>
  </div>
  <div class="le-topbar-right">
    <span class="room">ROOM __ROOM_CODE__</span>
    <span id="headerCount" class="count">—</span>
  </div>
</header>
<main class="main">
  <!-- Join -->
  <div id="joinScreen" class="card">
    <h1>Join session</h1>
    <p>Enter your display name. It will be visible to the facilitator.</p>
    <input id="nameInput" class="input" placeholder="Your name" autocomplete="name" maxlength="40"/>
    <button id="joinBtn" class="btn" style="margin-top:12px">Join session</button>
    <div id="joinOk" class="ok hidden"></div>
    <div id="joinErr" class="err hidden"></div>
    <p style="margin-top:14px;font-size:12px;color:#94a3b8;text-align:center">Room __ROOM_CODE__ · Synergy Cyber Security Awareness Month</p>
  </div>
  <!-- Waiting — lobby shows chosen module name -->
  <div id="waitingScreen" class="card hidden">
    <div class="waiting-icon">⏳</div>
    <h2 style="text-align:center">Waiting for facilitator</h2>
    <p id="waitingSub" style="text-align:center">You're in. The facilitator will launch the next activity shortly.</p>
    <div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:8px">
      <span id="waitingCount" class="badge">0 joined</span>
      <span id="waitingModule" class="badge">—</span>
    </div>
    <div id="waitingNames" style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px;justify-content:center"></div>
  </div>
  <!-- Participant intro — mirrors console's le-intro-screen (whyThisMatters) -->
  <div id="introScreen" class="card hidden" style="text-align:center">
    <div style="display:inline-flex;align-items:center;gap:8px;font-family:'Space Mono',monospace;font-size:11px;font-weight:800;color:#0891b2;background:#ecfeff;border:1px solid #a5f3fc;padding:4px 10px;border-radius:999px;text-transform:uppercase;letter-spacing:1px"><i class="fa-solid fa-circle-info"></i> Why This Matters</div>
    <p id="introText" style="margin:16px 0;font-size:15px;line-height:1.5;color:#0f172a"></p>
    <button id="introStartBtn" class="btn" style="width:100%;background:#06b6d4;color:white" type="button"><i class="fa-solid fa-play"></i> Start</button>
    <p style="margin-top:10px;font-family:'Space Mono',monospace;font-size:10px;color:#94a3b8">Synergy Cyber Security Awareness Month</p>
  </div>
  <!-- Self-paced activity — real per-module template mounted into #actMount, participant
       pages through the full item list at their own pace (their own Prev/Next below). -->
  <div id="activityScreen" class="card hidden">
    <div class="act-topline">
      <span id="actModuleBadge" class="badge live">—</span>
      <span id="actCount" class="badge">0 joined</span>
      <span id="actProgress" class="badge act-progress-badge">1 / 1</span>
    </div>
    <div id="actMount"></div>
    <div class="act-nav">
      <button id="actPrevBtn" class="btn secondary" type="button">‹ Prev</button>
      <button id="actNextBtn" class="btn secondary" type="button">Next ›</button>
    </div>
    <div id="actDots" class="le-progress-dots" style="justify-content:center;margin-top:14px"></div>
    <div id="actSubmitWrap" class="hidden" style="margin-top:16px; text-align:center; border-top:1px solid #e2e8f0; padding-top:14px">
      <button id="actSubmitBtn" class="btn" style="background:#10b981;color:#052e16;width:100%" type="button"><i class="fa-solid fa-paper-plane"></i> Done — Submit Answers</button>
      <div id="actSubmitHint" class="adm-note" style="margin-top:6px">Review with Prev/Next before you submit. After Submit your answers are locked — you can't change them.</div>
      <div id="actSubmitMsg" class="adm-note" style="margin-top:6px"></div>
    </div>
    <div id="reviewBackWrap" class="hidden" style="margin-top:12px; text-align:center; border-top:1px dashed #6ee7b7; padding-top:12px">
      <div class="adm-note" style="margin-bottom:8px;color:#065f46;font-weight:700">Review mode — answers locked, identification & recommendation shown below each answer.</div>
      <button id="backToSubmittedFromActivityBtn" class="btn secondary" style="width:100%" type="button"><i class="fa-solid fa-arrow-left"></i> Back to Confirmation</button>
    </div>
  </div>
  <!-- Submitted — deliberate locked confirmation, distinct from generic complete -->
  <div id="submittedScreen" class="card hidden" style="text-align:center; border-color:#6ee7b7; background:#ecfdf5">
    <div style="font-size:32px">✅</div>
    <h2 style="color:#065f46">Submitted — thanks!</h2>
    <p id="submittedMsg">Your answers for <span class="badge" id="submittedModule">—</span> have been recorded and are now locked. You can't edit them further.</p>
    <p style="font-size:12px;color:#065f46; font-weight:600">Waiting for facilitator to move the room on — same room, no re-scan needed.</p>
    <div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap; margin-top:8px">
      <span id="submittedCount" class="badge">—</span>
      <span id="submittedModule2" class="badge" style="background:#ecfdf5; border-color:#6ee7b7; color:#065f46">locked</span>
    </div>
    <p id="submittedAtLine" style="font-family:'Space Mono',monospace;font-size:11px;color:#64748b;margin-top:10px"></p>
    <div id="submittedRememberWrap" class="hidden" style="margin-top:14px; text-align:left; background:white; border:1px solid #6ee7b7; border-radius:12px; padding:14px">
      <div style="font-family:'Space Mono',monospace;font-size:11px;font-weight:800;color:#065f46;text-transform:uppercase;letter-spacing:1px"><i class="fa-solid fa-thumbtack"></i> Remember This</div>
      <div id="submittedRememberText" style="margin-top:6px;font-size:14px;font-weight:700;color:#0f172a"></div>
    </div>
    <button id="reviewAnswersBtn" class="btn secondary" style="width:100%;margin-top:14px" type="button"><i class="fa-solid fa-eye"></i> Review Answers with Details</button>
    <button id="backToSubmittedBtn" class="btn secondary hidden" style="width:100%;margin-top:8px" type="button"><i class="fa-solid fa-arrow-left"></i> Back to Confirmation</button>
  </div>
  <!-- Crossword compact single-column -->
  <div id="crosswordScreen" class="card hidden">
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <span id="cwClueCountBadge" class="badge live">Crossword</span>
      <span id="cwCount" class="badge">0 joined</span>
    </div>
    <div class="cw-wrap">
      <div id="cwStatus" class="cw-status">Loading grid…</div>
      <div class="cw-grid-wrap"><div id="cwGrid" class="cw-grid"></div></div>
      <div class="cw-clues">
        <div class="cw-clue-col"><h3>Across</h3><ul id="cwAcross" class="cw-clue-list"></ul></div>
        <div class="cw-clue-col"><h3>Down</h3><ul id="cwDown" class="cw-clue-list"></ul></div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button id="cwCheck" class="btn secondary" style="flex:1">Check</button>
        <button id="cwReveal" class="btn secondary" style="flex:1">Reveal</button>
      </div>
      <div id="cwProgressHint" style="margin-top:8px;font-family:'Space Mono',monospace;font-size:11px;color:#94a3b8;text-align:center">Progress syncs automatically (debounced)</div>
      <div id="cwSubmitWrap" style="margin-top:14px; text-align:center; border-top:1px solid #e2e8f0; padding-top:12px">
        <button id="cwSubmitBtn" class="btn" style="background:#10b981;color:#052e16;width:100%" type="button"><i class="fa-solid fa-paper-plane"></i> Done — Submit Grid</button>
        <div class="adm-note" style="margin-top:6px">Submit locks your grid — you can't edit after that.</div>
        <div id="cwSubmitMsg" class="adm-note" style="margin-top:6px"></div>
      </div>
      <div id="cwReviewBackWrap" class="hidden" style="margin-top:12px; text-align:center; border-top:1px dashed #6ee7b7; padding-top:12px">
        <div class="adm-note" style="margin-bottom:8px;color:#065f46;font-weight:700">Review mode — grid locked, submitted.</div>
        <button id="backToSubmittedFromCwBtn" class="btn secondary" style="width:100%" type="button"><i class="fa-solid fa-arrow-left"></i> Back to Confirmation</button>
      </div>
    </div>
  </div>
  <!-- Complete — same room stays for next activity -->
  <div id="completeScreen" class="card hidden" style="text-align:center">
    <div style="font-size:32px">🎉</div>
    <h2>Activity Complete</h2>
    <p>Great work! Waiting for facilitator to choose next activity — same room, no re-scan needed.</p>
    <div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap">
      <span id="completeCount" class="badge">0 joined</span>
      <span id="completeModule" class="badge">—</span>
    </div>
  </div>
  <!-- Error -->
  <div id="errorScreen" class="card hidden" style="border-color:#fca5a5">
    <h2 style="color:#7f1d1d">Connection issue</h2>
    <p id="errorMsg">—</p>
    <button id="retryBtn" class="btn secondary">Retry</button>
  </div>
</main>
<div id="reconnectBanner" class="reconnect hidden">Reconnecting…</div>
<script>
const ROOM_CODE = "__ROOM_CODE__";
const STORAGE_PID = 'participantId_' + ROOM_CODE;
const STORAGE_NAME = 'participantName_' + ROOM_CODE;
let participantId = localStorage.getItem(STORAGE_PID);
let participantName = localStorage.getItem(STORAGE_NAME);
let pollTimer = null;
let retryCount = 0;
let notFoundCount = 0;
// Guards against a slow poll tick's response landing AFTER a later tick's and rendering stale
// state over it (setInterval fires every 1.5s regardless of whether the previous request has
// resolved) — fetchState captures the sequence number current at its start and re-checks it
// right after the fetch resolves; a mismatch means a newer poll has already started, so this
// (now-stale) response is discarded instead of rendered.
let fetchSeq = 0;
const NOT_FOUND_RETRY_LIMIT = 3; // ~3 poll cycles at 1.5s = ~4.5s before giving up on a 404
let lastActiveModule = null;
let lastActiveItemId = null;
let hasAnsweredCurrentItem = false;
// Self-paced activity: local-only navigation state. actItems is fetched once per module (not
// re-fetched/re-rendered on every 1.5s poll — see fetchState) so a participant's own Prev/Next
// position and in-progress interaction are never disrupted by the ambient poll loop.
let actModuleLoaded = null;
let actItems = [];
let actIndex = 0;
// Submission state — per-participant per-module deliberate lock
let mySubmission = null; // {isSubmitted, submittedAt, module} for current activeModule from /state
let actIsSubmitted = false; // mirrors mySubmission for activityScreen (MC + pass-phrase)
let cwIsSubmitted = false;  // mirrors for crossword
let introDismissedFor = null; // module id for which participant intro was dismissed
let lastRememberThis = null;
let isReviewingAfterSubmit = false; // participant tapped Review on submittedScreen
let cwInitialized = false;
let cwWords = [];
let cwCells = new Map();
let cwRows = 0, cwCols = 0;
let cwCurrentRow = -1, cwCurrentCol = -1, cwCurrentDir = 'across';
let cwPendingDir = null;
let cwRevealed = false;
let cwProgressTimer = null;
let cwLastSent = null;
const CW_DEBOUNCE = 3500;

const els = {
  joinScreen: document.getElementById('joinScreen'),
  nameInput: document.getElementById('nameInput'),
  joinBtn: document.getElementById('joinBtn'),
  joinOk: document.getElementById('joinOk'),
  joinErr: document.getElementById('joinErr'),
  waitingScreen: document.getElementById('waitingScreen'),
  waitingCount: document.getElementById('waitingCount'),
  waitingModule: document.getElementById('waitingModule'),
  waitingNames: document.getElementById('waitingNames'),
  activityScreen: document.getElementById('activityScreen'),
  actModuleBadge: document.getElementById('actModuleBadge'),
  actCount: document.getElementById('actCount'),
  actProgress: document.getElementById('actProgress'),
  actMount: document.getElementById('actMount'),
  actPrevBtn: document.getElementById('actPrevBtn'),
  actNextBtn: document.getElementById('actNextBtn'),
  actDots: document.getElementById('actDots'),
  actSubmitWrap: document.getElementById('actSubmitWrap'),
  actSubmitBtn: document.getElementById('actSubmitBtn'),
  actSubmitMsg: document.getElementById('actSubmitMsg'),
  introScreen: document.getElementById('introScreen'),
  introText: document.getElementById('introText'),
  introStartBtn: document.getElementById('introStartBtn'),
  submittedScreen: document.getElementById('submittedScreen'),
  submittedModule: document.getElementById('submittedModule'),
  submittedModule2: document.getElementById('submittedModule2'),
  submittedCount: document.getElementById('submittedCount'),
  submittedAtLine: document.getElementById('submittedAtLine'),
  submittedRememberWrap: document.getElementById('submittedRememberWrap'),
  submittedRememberText: document.getElementById('submittedRememberText'),
  reviewAnswersBtn: document.getElementById('reviewAnswersBtn'),
  backToSubmittedBtn: document.getElementById('backToSubmittedBtn'),
  reviewBackWrap: document.getElementById('reviewBackWrap'),
  backToSubmittedFromActivityBtn: document.getElementById('backToSubmittedFromActivityBtn'),
  cwReviewBackWrap: document.getElementById('cwReviewBackWrap'),
  backToSubmittedFromCwBtn: document.getElementById('backToSubmittedFromCwBtn'),
  crosswordScreen: document.getElementById('crosswordScreen'),
  cwClueCountBadge: document.getElementById('cwClueCountBadge'),
  cwCount: document.getElementById('cwCount'),
  cwGrid: document.getElementById('cwGrid'),
  cwAcross: document.getElementById('cwAcross'),
  cwDown: document.getElementById('cwDown'),
  cwStatus: document.getElementById('cwStatus'),
  cwCheck: document.getElementById('cwCheck'),
  cwReveal: document.getElementById('cwReveal'),
  cwSubmitWrap: document.getElementById('cwSubmitWrap'),
  cwSubmitBtn: document.getElementById('cwSubmitBtn'),
  cwSubmitMsg: document.getElementById('cwSubmitMsg'),
  completeScreen: document.getElementById('completeScreen'),
  completeCount: document.getElementById('completeCount'),
  completeModule: document.getElementById('completeModule'),
  errorScreen: document.getElementById('errorScreen'),
  errorMsg: document.getElementById('errorMsg'),
  retryBtn: document.getElementById('retryBtn'),
  headerCount: document.getElementById('headerCount'),
  reconnectBanner: document.getElementById('reconnectBanner'),
};

function showScreen(name){
  els.joinScreen.classList.add('hidden');
  els.waitingScreen.classList.add('hidden');
  if(els.introScreen) els.introScreen.classList.add('hidden');
  els.activityScreen.classList.add('hidden');
  if(els.submittedScreen) els.submittedScreen.classList.add('hidden');
  els.crosswordScreen.classList.add('hidden');
  if(els.completeScreen) els.completeScreen.classList.add('hidden');
  els.errorScreen.classList.add('hidden');
  if(name==='join') els.joinScreen.classList.remove('hidden');
  if(name==='waiting') els.waitingScreen.classList.remove('hidden');
  if(name==='intro' && els.introScreen) els.introScreen.classList.remove('hidden');
  if(name==='activity') els.activityScreen.classList.remove('hidden');
  if(name==='submitted' && els.submittedScreen) els.submittedScreen.classList.remove('hidden');
  if(name==='crossword') els.crosswordScreen.classList.remove('hidden');
  if(name==='complete' && els.completeScreen) els.completeScreen.classList.remove('hidden');
  if(name==='error') els.errorScreen.classList.remove('hidden');
}
function showErr(msg){
  els.joinErr.textContent = msg;
  els.joinErr.classList.remove('hidden');
}
function hideErr(){
  els.joinErr.classList.add('hidden');
  els.joinErr.textContent = '';
}
function updateHeaderCount(n){
  els.headerCount.textContent = n + ' joined';
  els.waitingCount.textContent = n + ' joined';
  els.actCount.textContent = n + ' joined';
  els.cwCount.textContent = n + ' joined';
  if(els.completeCount) els.completeCount.textContent = n + ' joined';
  if(els.submittedCount) els.submittedCount.textContent = n + ' joined';
}
function esc(s){ return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function doJoin(){
  const name = els.nameInput.value.trim();
  if(!name){ showErr('Please enter your name'); return; }
  if(name.length<1 || name.length>40){ showErr('Name must be 1-40 characters'); return; }
  els.joinBtn.disabled = true;
  hideErr();
  try{
    const r = await fetch('/api/session/' + ROOM_CODE + '/join', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name})});
    const j = await r.json().catch(()=>({}));
    if(!r.ok){
      if(j.error === 'room not found') throw new Error('This session has ended or the room code is wrong. Please check with the facilitator or ask for a new QR.');
      throw new Error('Could not join — please try again.');
    }
    participantId = j.participantId;
    participantName = name;
    localStorage.setItem(STORAGE_PID, participantId);
    localStorage.setItem(STORAGE_NAME, name);
    startPolling();
  }catch(e){
    showErr(e.message || 'Join failed — check connection');
  }finally{
    els.joinBtn.disabled = false;
  }
}

// --- Self-paced activity: full sequence pushed once, participant pages through it locally ---
const MC_MODULES = ['fault-finding','myth-vs-fact','decision-room','closing-quiz','clue-quest','pass-phrase'];

async function submitAnswer(item, optionId){
  const r = await fetch('/api/session/' + ROOM_CODE + '/respond', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({participantId: participantId, itemId: item.id, optionId: optionId})});
  const j = await r.json().catch(()=>({}));
  if(!r.ok){
    if(j.error && j.error.includes('unknown participantId')){
      localStorage.removeItem(STORAGE_PID);
      localStorage.removeItem(STORAGE_NAME);
      participantId = null;
      showScreen('join');
      showErr('Session reset — please re-join with your name');
      stopPolling();
      return false;
    }
    throw new Error(j.error || 'Submit failed');
  }
  item.myAnswer = optionId; // update local copy so navigating back shows the selection
  if(j.isCorrect!=null) item.myAnswerCorrect = j.isCorrect; // per-item feedback only — never a tally
  return true;
}

// --- Submission helpers — deliberate lock per participant per module ---
function isActivityAllAnswered(){
  if(!actItems || !actItems.length) return false;
  // pass-phrase: each round counts as answered once at least one char placed
  if(actModuleLoaded === 'pass-phrase'){
    return actItems.every(it=>{
      const hasLocal = it._ppSlots && it._ppSlots.length>0;
      const hasServer = it.myBuild && it.myBuild.builtPassword && it.myBuild.builtPassword.length>0;
      return hasLocal || hasServer;
    });
  }
  // MC modules with discrete options: every item has a myAnswer
  return actItems.every(it=> it.myAnswer!=null);
}
function updateActivitySubmitVisibility(){
  if(!els.actSubmitWrap) return;
  if(actIsSubmitted){
    els.actSubmitWrap.classList.add('hidden');
    return;
  }
  if(isActivityAllAnswered()){
    els.actSubmitWrap.classList.remove('hidden');
    if(els.actSubmitBtn){
      els.actSubmitBtn.disabled = false;
      els.actSubmitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Done — Submit Answers';
    }
  } else {
    // Also show on last item even if not all answered? Spec says after last item — but for MC we
    // prefer to prompt only when all answered; for continuous modules (crossword/pass-phrase) the
    // crossword has its own submit. Keep hidden until all answered to nudge completion.
    // However if participant is on last item and wants to submit incomplete, they can still tap
    // once they reach last item — show disabled hint.
    if(actIndex === actItems.length - 1 && actItems.length>0){
      els.actSubmitWrap.classList.remove('hidden');
      if(els.actSubmitBtn){
        const allDone = isActivityAllAnswered();
        els.actSubmitBtn.disabled = !allDone;
        els.actSubmitBtn.innerHTML = allDone
          ? '<i class="fa-solid fa-paper-plane"></i> Done — Submit Answers'
          : '<i class="fa-solid fa-paper-plane"></i> Answer all items to submit';
      }
    } else {
      els.actSubmitWrap.classList.add('hidden');
    }
  }
}
async function doActivitySubmit(){
  if(actIsSubmitted) return;
  const module = actModuleLoaded;
  if(!module || !participantId) return;
  if(!isActivityAllAnswered()){
    if(els.actSubmitMsg) els.actSubmitMsg.textContent = 'Please answer every item before submitting.';
    return;
  }
  if(els.actSubmitBtn) els.actSubmitBtn.disabled = true;
  if(els.actSubmitMsg) els.actSubmitMsg.textContent = 'Submitting…';
  try{
    const r = await fetch('/api/session/' + ROOM_CODE + '/submit', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({participantId: participantId, module: module})});
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || 'Submit failed');
    actIsSubmitted = true;
    mySubmission = {isSubmitted: true, submittedAt: j.submittedAt, module: module};
    showSubmittedFor(module, j.submittedAt);
    if(els.actSubmitMsg) els.actSubmitMsg.textContent = '';
  }catch(e){
    if(els.actSubmitMsg) els.actSubmitMsg.textContent = 'Submit failed: ' + (e.message||'');
    if(els.actSubmitBtn) els.actSubmitBtn.disabled = false;
  }
}
function showSubmittedFor(module, submittedAt){
  actIsSubmitted = true;
  // Hide activity/crossword and show dedicated submitted confirmation
  // Keep module name for display
  if(els.submittedModule) els.submittedModule.textContent = module;
  if(els.submittedModule2) els.submittedModule2.textContent = module + ' · locked';
  if(els.submittedAtLine && submittedAt){
    try{ els.submittedAtLine.textContent = 'Submitted at ' + new Date(submittedAt).toLocaleTimeString(); }catch(e){ els.submittedAtLine.textContent = ''; }
  }
  if(els.submittedRememberWrap && els.submittedRememberText){
    if(lastRememberThis){
      els.submittedRememberText.textContent = lastRememberThis;
      els.submittedRememberWrap.classList.remove('hidden');
    } else {
      els.submittedRememberWrap.classList.add('hidden');
    }
  }
  showScreen('submitted');
}
function updateCwSubmitVisibility(){
  if(!els.cwSubmitWrap) return;
  if(cwIsSubmitted){
    els.cwSubmitWrap.classList.add('hidden');
    return;
  }
  // Crossword: always show submit once grid initialized — participant decides when finished
  if(cwInitialized){
    els.cwSubmitWrap.classList.remove('hidden');
    if(els.cwSubmitBtn) els.cwSubmitBtn.disabled = false;
  } else {
    els.cwSubmitWrap.classList.add('hidden');
  }
}
async function doCwSubmit(){
  if(cwIsSubmitted) return;
  const module = 'crossword';
  if(!participantId) return;
  if(els.cwSubmitBtn) els.cwSubmitBtn.disabled = true;
  if(els.cwSubmitMsg) els.cwSubmitMsg.textContent = 'Submitting…';
  try{
    const r = await fetch('/api/session/' + ROOM_CODE + '/submit', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({participantId: participantId, module: module})});
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || 'Submit failed');
    cwIsSubmitted = true;
    mySubmission = {isSubmitted: true, submittedAt: j.submittedAt, module: module};
    showSubmittedFor(module, j.submittedAt);
    // Lock grid inputs
    cwCells.forEach(cell=>{ if(cell.input) cell.input.readOnly = true; });
    if(els.cwSubmitMsg) els.cwSubmitMsg.textContent = '';
  }catch(e){
    if(els.cwSubmitMsg) els.cwSubmitMsg.textContent = 'Submit failed: ' + (e.message||'');
    if(els.cwSubmitBtn) els.cwSubmitBtn.disabled = false;
  }
}
let pendingIntroModule = null;
function showParticipantIntro(curMod, whyText){
  if(!whyText) return false;
  if(introDismissedFor === curMod) return false;
  pendingIntroModule = curMod;
  if(els.introText) els.introText.textContent = whyText;
  showScreen('intro');
  return true;
}
function dismissParticipantIntro(){
  if(!pendingIntroModule) {
    // Fallback: use last activeModule from mySubmission or actModuleLoaded
    const fallback = actModuleLoaded || (mySubmission && mySubmission.module);
    if(fallback) pendingIntroModule = fallback;
    else return;
  }
  introDismissedFor = pendingIntroModule;
  const mod = pendingIntroModule;
  pendingIntroModule = null;
  if(mod === 'crossword'){
    showScreen('crossword');
    ensureCrossword();
    setTimeout(updateCwSubmitVisibility, 400);
  } else if(MC_MODULES.includes(mod)){
    showScreen('activity');
    if(actModuleLoaded === mod) renderActivityItem();
    else {
      // Module not yet init'd — next fetchState poll will init, but show placeholder
      if(els.actMount) els.actMount.innerHTML = '<p style="color:#64748b;text-align:center">Loading activity…</p>';
    }
  } else {
    showScreen('activity');
  }
}
if(els.introStartBtn) els.introStartBtn.addEventListener('click', dismissParticipantIntro);
if(els.reviewAnswersBtn) els.reviewAnswersBtn.addEventListener('click', ()=>{
  isReviewingAfterSubmit = true;
  const mod = pendingIntroModule || introDismissedFor || actModuleLoaded || (mySubmission && mySubmission.module);
  if(!mod) return;
  if(mod === 'crossword'){
    showScreen('crossword');
    ensureCrossword();
    setTimeout(()=>{
      cwCells.forEach(cell=>{ if(cell.input) cell.input.readOnly = true; });
      if(els.cwReviewBackWrap) els.cwReviewBackWrap.classList.remove('hidden');
      if(els.cwSubmitWrap) els.cwSubmitWrap.classList.add('hidden');
    }, 300);
  } else if(MC_MODULES.includes(mod)){
    showScreen('activity');
    if(els.reviewBackWrap) els.reviewBackWrap.classList.remove('hidden');
    if(els.actSubmitWrap) els.actSubmitWrap.classList.add('hidden');
    if(actModuleLoaded === mod) renderActivityItem();
  }
});
if(els.backToSubmittedBtn) els.backToSubmittedBtn.addEventListener('click', ()=>{
  isReviewingAfterSubmit = false;
  const mod = mySubmission ? mySubmission.module : null;
  const at = mySubmission ? mySubmission.submittedAt : null;
  if(mod) showSubmittedFor(mod, at);
});
if(els.backToSubmittedFromActivityBtn) els.backToSubmittedFromActivityBtn.addEventListener('click', ()=>{
  isReviewingAfterSubmit = false;
  const mod = mySubmission ? mySubmission.module : actModuleLoaded;
  const at = mySubmission ? mySubmission.submittedAt : null;
  if(mod) showSubmittedFor(mod, at);
  if(els.reviewBackWrap) els.reviewBackWrap.classList.add('hidden');
});
if(els.backToSubmittedFromCwBtn) els.backToSubmittedFromCwBtn.addEventListener('click', ()=>{
  isReviewingAfterSubmit = false;
  showSubmittedFor('crossword', mySubmission && mySubmission.submittedAt);
  if(els.cwReviewBackWrap) els.cwReviewBackWrap.classList.add('hidden');
});

// initActivity() runs ONCE per module (when actModuleLoaded changes) — see fetchState. Poll
// ticks for the SAME module never call this again, so a participant's own Prev/Next position
// and any in-progress tap are never disrupted by the ambient 1.5s poll loop.
function initActivity(module, items){
  actModuleLoaded = module;
  actItems = items || [];
  actIndex = 0;
  // Reset per-activity submission lock from server state (fetchState will have set mySubmission)
  actIsSubmitted = !!(mySubmission && mySubmission.isSubmitted && mySubmission.module===module);
  els.actModuleBadge.textContent = module;
  renderActivityItem();
}

function updateActivityChrome(){
  const total = actItems.length;
  els.actProgress.textContent = (actIndex+1) + ' / ' + total;
  els.actPrevBtn.disabled = actIndex<=0;
  els.actNextBtn.disabled = actIndex>=total-1;
  els.actDots.innerHTML = actItems.map((it,i)=>{
    // pass-phrase has no single "answer" — a round counts as engaged once at least one
    // character has been placed. Checks both the locally-built slots (rounds visited this
    // session) and the server's myBuild record (rounds built before a refresh/resume).
    const hasBuild = (it._ppSlots && it._ppSlots.length>0)
      || (it.myBuild && it.myBuild.builtPassword && it.myBuild.builtPassword.length>0);
    const cls = ['dot']; if(it.myAnswer!=null || hasBuild) cls.push('done'); if(i===actIndex) cls.push('current');
    return '<span class="'+cls.join(' ')+'"></span>';
  }).join('');
  updateActivitySubmitVisibility();
}

function renderActivityItem(){
  const item = actItems[actIndex];
  if(!item){ els.actMount.innerHTML = '<p style="color:#94a3b8">No items in this activity.</p>'; return; }
  const renderer = ACTIVITY_RENDERERS[actModuleLoaded] || renderGenericItem;
  els.actMount.innerHTML = renderer(item);
  // Pass-phrase has no [data-answer-opt] vote at all — it's a free-build deck/slot
  // interaction with its own wiring and its own debounced submit, not a single-answer lock.
  if(actModuleLoaded === 'pass-phrase') wirePassPhraseBuild(item);
  else wireActivityOptions(item);
  updateActivityChrome();
}

function wireActivityOptions(item){
  // If already submitted for this module, lock completely — no further edits even via Prev
  if(actIsSubmitted){
    els.actMount.querySelectorAll('[data-answer-opt]').forEach(btn=>{
      btn.style.pointerEvents = 'none';
      btn.disabled = true;
      const optId = btn.dataset.answerOpt;
      if(String(item.myAnswer)===String(optId)) btn.classList.add('picked');
    });
    return;
  }
  const already = item.myAnswer!=null;
  els.actMount.querySelectorAll('[data-answer-opt]').forEach(btn=>{
    const optId = btn.dataset.answerOpt;
    if(already){
      btn.style.pointerEvents = 'none';
      if(String(item.myAnswer)===String(optId)) btn.classList.add('picked');
      return;
    }
    btn.addEventListener('click', async ()=>{
      if(actIsSubmitted) return;
      els.actMount.querySelectorAll('[data-answer-opt]').forEach(b=>{ b.style.pointerEvents='none'; });
      try{
        const ok = await submitAnswer(item, optId);
        if(!ok) return;
        // Re-render this same item (not just toggle a class) so every module's own "picked"
        // text/state (e.g. fault-finding's "Tap if fake" -> "Your answer") stays in sync,
        // not just the border color.
        renderActivityItem();
        // Brief pause so the tap visibly registers, then auto-advance (participant can still
        // use Prev to go back and change an answer — /respond allows overwrite). Items with
        // correct/wrong feedback get longer — that's meant to be read, not just glimpsed.
        const advanceDelay = item.myAnswerCorrect!=null ? 1400 : 550;
        setTimeout(()=>{ if(actIndex < actItems.length-1){ actIndex++; renderActivityItem(); } }, advanceDelay);
      }catch(e){
        const msg = (e.message||'');
        if(msg.includes('already submitted')){
          actIsSubmitted = true;
          if(els.actSubmitMsg) els.actSubmitMsg.textContent = 'Already submitted — answers locked.';
          showSubmittedFor(actModuleLoaded, mySubmission && mySubmission.submittedAt);
          return;
        }
        els.actMount.querySelectorAll('[data-answer-opt]').forEach(b=>{ b.style.pointerEvents=''; });
      }
    });
  });
}
els.actPrevBtn.addEventListener('click', ()=>{ if(actIndex>0){ actIndex--; renderActivityItem(); } });
els.actNextBtn.addEventListener('click', ()=>{ if(actIndex<actItems.length-1){ actIndex++; renderActivityItem(); } });
// Submit handlers — wired once, safe to re-add (idempotent guard inside)
if(els.actSubmitBtn) els.actSubmitBtn.addEventListener('click', doActivitySubmit);
if(els.cwSubmitBtn) els.cwSubmitBtn.addEventListener('click', doCwSubmit);

// --- Per-module templates — adapted from the facilitator console's own component classes
// (console.css, linked above) so a phone and the big screen read as the same activity. ---
function renderFaultFinding(item){
  const picked = item.myAnswer;
  const panel = (letter, img)=> '<button type="button" class="ff-compare-panel'+(picked===letter?' picked':'')+'" data-answer-opt="'+letter+'">'
    + '<div class="ff-compare-label">OPTION '+letter+'</div>'
    + (img ? '<img src="'+esc(img)+'" alt="Option '+letter+'"/>' : '<div style="padding:24px;text-align:center;color:#94a3b8">(no image)</div>')
    + '<div class="ff-tap-hint">'+(picked===letter?'✓ Your answer':'Tap if this one is fake')+'</div>'
    + '</button>';
  // Parity with console: show persona · category like fault-finding.js:96-97
  const ffTag = [item.persona, item.category].filter(Boolean).join(' · ');
  return '<div class="ff-compare-frame">'
    + (ffTag ? '<div class="ff-category-tag" style="display:inline-block;margin-bottom:8px">'+esc(ffTag)+'</div>' : '')
    + '<div style="text-align:center;font-weight:800;margin-bottom:10px;color:var(--navy,#001a4d)">Which one is <span style="color:var(--red,#ef4444)">FAKE</span>?</div>'
    + '<div class="ff-compare-row">' + panel('A', item.realImage) + panel('B', item.fakeImage) + '</div>'
    + '</div>' + renderCorrectFeedback(item);
}
// Hybrid feedback: immediate badge (Correct/Not quite) after answer, plus full
// identification + recommendation (fact/whatIsWrong) only after deliberate Submit —
// mirrors console's Reveal (whatIsWrong + whyItsSuspicious) but delayed until locked.
function renderCorrectFeedback(item){
  let html = '';
  if(item.myAnswerCorrect!=null){
    html += item.myAnswerCorrect
      ? '<div class="feedback-badge correct"><i class="fa-solid fa-check"></i> Correct</div>'
      : '<div class="feedback-badge incorrect"><i class="fa-solid fa-xmark"></i> Not quite</div>';
  }
  if(item.fact){
    html += '<div style="margin-top:10px;background:#f0f9ff;border-left:3px solid #0ea5e9;padding:10px 12px;border-radius:6px;font-size:13px;line-height:1.5;color:#0c4a6e;text-align:left"><strong>Details — Identification & Recommendation:</strong><br>'+esc(item.fact)+'</div>';
  } else if(item.myAnswerCorrect==null && !item.fact){
    return '';
  }
  return html;
}
function renderMythVsFact(item){
  const picked = item.myAnswer;
  return '<div class="mf-card">'
    + (item.topic ? '<div class="mf-topic-tag">'+esc(item.topic)+'</div>' : '')
    + '<div class="mf-myth" style="margin-top:10px">'+esc(item.prompt||'')+'</div>'
    + '<div class="options">' + (item.options||[]).map(opt=>{
        const sel = picked!=null && String(picked)===String(opt.id);
        return '<button type="button" class="option-btn'+(sel?' selected picked':'')+'" data-answer-opt="'+esc(opt.id)+'">'+esc(opt.text)+'</button>';
      }).join('') + '</div>'
    + renderCorrectFeedback(item) + '</div>';
}
function renderDecisionRoom(item){
  const picked = item.myAnswer;
  let html = '';
  if(item.persona || item.caseTitle){
    html += '<div class="ff-title-bar">';
    if(item.persona) html += '<div class="dr-persona-tag">'+esc(item.persona)+'</div>';
    if(item.caseTitle) html += '<h2 style="margin:8px 0 4px;font-size:18px;color:var(--navy,#001a4d)">'+esc(item.caseTitle)+'</h2>';
    if(item.caseScenario) html += '<div class="dr-scenario-context">'+esc(item.caseScenario)+'</div>';
    html += '</div>';
  }
  html += '<div class="dr-scene"><div class="dr-prompt" style="margin:14px 0;color:var(--navy,#001a4d);font-weight:700">'+esc(item.prompt||'')+'</div>';
  html += '<div class="dr-options">' + (item.options||[]).map((opt,idx)=>{
    const letter = String.fromCharCode(65+idx);
    const sel = picked!=null && String(picked)===String(opt.id);
    return '<button type="button" class="dr-option'+(sel?' picked':'')+'" data-answer-opt="'+esc(opt.id)+'"><span class="dr-opt-letter">'+letter+'</span><span class="dr-opt-text">'+esc(opt.text)+'</span></button>';
  }).join('') + '</div></div>' + renderCorrectFeedback(item);
  return html;
}
function renderClosingQuiz(item){
  const picked = item.myAnswer;
  const choiceRow = (opt, letter)=>{
    const sel = picked!=null && String(picked)===String(opt.id);
    return '<div class="qz-choice'+(sel?' picked':'')+'" data-answer-opt="'+esc(opt.id)+'"><span class="qz-letter">'+esc(letter)+'</span><span>'+esc(opt.text)+'</span></div>';
  };
  const personaTag = item.persona ? '<div class="qz-persona-tag">'+esc(item.persona)+'</div>' : '';
  if(item.kind === 'svr'){
    return personaTag + '<div class="svr-scenario-card"><div class="svr-scenario-text">'+esc(item.prompt||'')+'</div></div>'
      + '<div class="qz-choices">' + (item.options||[]).map(opt=>choiceRow(opt, opt.text[0])).join('') + '</div>'
      + renderCorrectFeedback(item);
  }
  return personaTag + '<div class="qz-question">'+esc(item.prompt||'')+'</div>'
    + '<div class="qz-choices">' + (item.options||[]).map((opt,idx)=>choiceRow(opt, String.fromCharCode(65+idx))).join('') + '</div>'
    + renderCorrectFeedback(item);
}
function renderClueQuest(item){
  const picked = item.myAnswer;
  // Parity with console: console shuffles options per render (clue-quest.js:40 shuffle). Phone now
  // also shuffles display order so neither surface has a fixed position tell; correctness still
  // keyed by optionId, not position.
  const shuffled = (item.options||[]).slice().sort(()=> Math.random()-0.5);
  return '<div class="cq-riddle-card"><div class="cq-riddle-text">'+esc(item.prompt||'')+'</div></div>'
    + '<div class="cq-options">' + shuffled.map((opt,idx)=>{
        const sel = picked!=null && String(picked)===String(opt.id);
        return '<div class="cq-option'+(sel?' picked':'')+'" data-answer-opt="'+esc(opt.id)+'"><span class="cq-opt-num">'+(idx+1)+'</span>'+esc(opt.text)+'</div>';
      }).join('') + '</div>' + renderCorrectFeedback(item);
}
// --- Pass-phrase: real build-your-own-password mechanic (tap-to-place, not drag — touch
// drag was already deemed unreliable in an earlier pass). Matches the console's actual
// activity (a themed deck, a 12-slot password row, a live strength meter) instead of a
// rating poll on a pre-built password. ---

// Verbatim from live-event/modules/pass-phrase.js's own computeStrength() (trimmed to the
// fields the phone UI needs) — same scoring the console uses, so the live meter here matches
// exactly. The debounced POST to /passphrase/build re-runs this SAME logic server-side
// (_pp_compute_strength in app.py) as the authoritative, stored value — this copy is only an
// instant local preview so the meter doesn't wait on a network round-trip for every tap.
function ppComputeStrength(pw, weak){
  var checks = {
    upper: /[A-Z]/.test(pw), lower: /[a-z]/.test(pw),
    number: /[0-9]/.test(pw), special: /[^A-Za-z0-9]/.test(pw)
  };
  var score=0;
  if(pw.length >=12) score+=25; else if(pw.length >=8) score+=10;
  if(pw.length >=16) score+=10;
  if(checks.upper) score+=15;
  if(checks.lower) score+=15;
  if(checks.number) score+=15;
  if(checks.special) score+=15;
  if(checks.upper && checks.lower && checks.number && checks.special && pw.length>=12) score+=5;
  if(weak){
    var normPw=pw.toLowerCase(), normWeak=weak.toLowerCase();
    if(normPw===normWeak) score=Math.max(0,score-30);
    else if(normPw.includes(normWeak) || normWeak.includes(normPw)) score=Math.max(0,score-15);
    if(pw.length - weak.length <=2 && normPw.includes(normWeak.slice(0,4))) score=Math.max(0,score-10);
  }
  if(/(.)\1{2,}/.test(pw)) score=Math.max(0,score-10);
  score=Math.min(100,Math.max(0,score));
  var label='Weak', color='#ef4444';
  if(pw.length===0 || score<40){ label='Weak'; color='#ef4444'; }
  else if(score<60){ label='Fair'; color='#f59e0b'; }
  else if(score<80){ label='Strong'; color='#10b981'; }
  else { label='Very Strong'; color='#065f46'; }
  return {score:score, label:label, color:color};
}

// Local-only build state, stashed directly on the item object (same pattern as myAnswer)
// so navigating away and back to a round preserves in-progress placement without a round-trip.
// Chunk-aware: deck is 15 mixed chunks (e.g. "Ka","Th","on", singles, symbols). Password row
// holds whole chunks per tile (not single characters), capped by total character count
// (maxChars 20) not tile count. Deck availability is per chunk, and resume from myBuild's
// builtPassword string (which loses chunk boundaries) is reconstructed greedily by matching
// deck chunks against the built string — preferring longer chunks first — sufficient for
// demo continuity; exact chunk identity is recovered via server-stored strength anyway.
//
// _ppSlots is a COMPACT array — one entry per placed chunk, in placement order, with no gaps
// ever stored (previously this was a fixed-length array pre-filled with nulls and chunks were
// written directly to whatever slot index the participant tapped, which could leave nulls in
// the middle if that tap didn't land on the very next sequential empty button — the row then
// rendered those nulls as gaps between chunks). Placing always appends to the end of this
// array; removing always splices the chunk out, so everything after it shifts down automatically
// and the row can never show a gap or have chunks render out of placement order.
function ppEnsureState(item){
  if(item._ppSlots) return;
  var maxChars = item.maxChars || item.maxSlots || 20;
  var deck = item.deck || [];
  var maxTiles = deck.length || 15;
  var slots = [];
  var built = (item.myBuild && item.myBuild.builtPassword) || '';
  var deckAvail = deck.map(function(){ return true; });
  // Reconstruct which deck chunks were used to build the string, greedily matching
  // longest deck chunks first to disambiguate ("Ka" vs "K"+"a").
  var pos = 0;
  // Build a copy of deck sorted by length desc for matching
  var deckByLen = deck.map(function(ch, idx){ return {ch:ch, idx:idx}; });
  deckByLen.sort(function(a,b){ return b.ch.length - a.ch.length; });
  while(pos < built.length && slots.length < maxTiles){
    var matched = null;
    var matchLen = 0;
    for(var k=0;k<deckByLen.length;k++){
      var entry = deckByLen[k];
      if(!deckAvail[entry.idx]) continue;
      var chunk = entry.ch;
      if(built.substr(pos, chunk.length) === chunk){
        matched = entry;
        matchLen = chunk.length;
        break;
      }
    }
    if(matched){
      slots.push(matched.ch);
      deckAvail[matched.idx] = false;
      pos += matchLen;
    } else {
      // No deck chunk matches at this position — fall back to single char (may be residue
      // from old single-char content still in wild). Treat built[pos] as a tile if it exists
      // as a deck entry, else just advance.
      var ch = built[pos];
      var foundIdx = -1;
      for(var i=0;i<deck.length;i++){ if(deckAvail[i] && deck[i]===ch){ foundIdx=i; break; } }
      if(foundIdx!==-1){
        slots.push(ch);
        deckAvail[foundIdx]=false;
      } else {
        // orphan char — place it anyway as a tile (deck-less) so password string is preserved
        slots.push(ch);
      }
      pos += 1;
    }
  }
  // Enforce maxChars cap: if reconstructed string exceeds maxChars, drop chunks off the end
  var totalChars = slots.join('').length;
  while(totalChars > maxChars && slots.length>0){
    var removed = slots.pop();
    if(removed){
      for(var i=0;i<deck.length;i++){ if(!deckAvail[i] && deck[i]===removed){ deckAvail[i]=true; break; } }
    }
    totalChars = slots.join('').length;
  }
  item._ppSlots = slots;
  item._ppDeckAvailable = deckAvail;
  item._ppSelectedDeckIdx = null;
  item._ppMaxTiles = maxTiles;
  item._ppMaxChars = maxChars;
}

let ppSubmitTimer = null;
function ppSubmitBuild(item){
  if(actIsSubmitted) return;
  clearTimeout(ppSubmitTimer);
  ppSubmitTimer = setTimeout(function(){
    if(actIsSubmitted) return;
    const built = item._ppSlots.join('');
    fetch('/api/session/' + ROOM_CODE + '/passphrase/build', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({participantId: participantId, roundId: item.id, builtPassword: built})
    }).catch(function(){});
  }, 500);
}

function renderPassPhrase(item){
  ppEnsureState(item);
  const built = item._ppSlots.join('');
  const result = ppComputeStrength(built, item.weakPassword||'');
  const maxChars = item._ppMaxChars || item.maxChars || 20;
  const difficulty = item.difficulty || 'medium';
  const diffLabel = difficulty.charAt(0).toUpperCase()+difficulty.slice(1);
  const twoCount = (item.deck||[]).filter(function(c){return String(c).length>1;}).length;
  let html = '<div class="pp-weak-card">'
    + '<div class="pp-weak-label"><i class="fa-solid fa-triangle-exclamation"></i> Starting Sample — Weak <span style="margin-left:6px;font-weight:400;opacity:0.7">['+esc(diffLabel)+']</span></div>'
    + '<div class="pp-weak-text">'+esc(item.weakPassword||'')+'</div>'
    + (item.weakRequirement ? '<div class="pp-weak-meta">'+esc(diffLabel+' — '+item.weakRequirement+' — deck has '+item.deck.length+' chunks ('+twoCount+' ×2-char) to rebuild strong (cap '+maxChars+' chars)')+'</div>' : '')
    + '</div>';
  html += '<div class="pp-builder-card" style="margin-top:14px;padding:14px">'
    + '<div class="pp-strength"><div class="pp-strength-head">'
    + '<span class="pp-strength-label" style="color:'+result.color+'">Strength: '+result.label+'</span>'
    + '<span style="margin-left:8px;color:#94a3b8;font-family:Space Mono,monospace;font-size:12px">'+result.score+' / 100</span>'
    + '</div>'
    + '<div class="pp-meter"><div class="pp-meter-fill" style="width:'+result.score+'%;background:'+result.color+'"></div></div>'
    + '<div class="pp-meter-labels"><span>Weak</span><span>Fair</span><span>Strong</span><span>V.Strong</span></div>'
    + '</div></div>';
  html += '<div class="pp-section-label"><i class="fa-solid fa-lock"></i> Your Password <span>'+built.length+' / '+maxChars+' chars</span></div>';
  // Filled tiles render first, in placement order (item._ppSlots is a compact array — see
  // ppEnsureState), immediately followed by whatever empty slots remain — so a gap can never
  // appear between two placed chunks, only ever after the last one.
  const emptyCount = Math.max(0, (item._ppMaxTiles||item.deck.length||0) - item._ppSlots.length);
  html += '<div class="pp-tiles" id="ppSlotsRow">'
    + item._ppSlots.map((ch,i)=>{
        const chunkCls = String(ch).length>1 ? ' chunk-tile' : '';
        return '<button type="button" class="pp-tile'+chunkCls+'" data-slot-idx="'+i+'" data-filled="1"><span class="pp-tile-letter">'+esc(ch)+'</span></button>';
      }).join('')
    + Array(emptyCount).fill('<button type="button" class="pp-slot-empty"></button>').join('')
    + '</div>';
  html += '<div class="pp-section-label" style="margin-top:14px">'
    + '<i class="fa-solid fa-layer-group"></i> Deck — tap a chunk, then tap a slot above <span style="margin-left:auto;color:#94a3b8;font-weight:400">['+esc(diffLabel)+' · '+twoCount+'×2-char]</span></div>';
  html += '<div class="pp-deck" id="ppDeckTray">' + item.deck.map((ch,i)=>{
      const avail = item._ppDeckAvailable[i];
      const isSelected = item._ppSelectedDeckIdx===i;
      const cls = ['pp-tile','pp-deck-tile']; if(String(ch).length>1) cls.push('chunk-tile'); if(!avail) cls.push('is-inert'); if(isSelected) cls.push('selected');
      return '<button type="button" class="'+cls.join(' ')+'" data-deck-idx="'+i+'" '+(!avail?'disabled':'')+'><span class="pp-tile-letter">'+esc(ch)+'</span></button>';
    }).join('') + '</div>';
  html += '<div style="margin-top:6px;font-family:Space Mono,monospace;font-size:11px;color:#64748b;text-align:center">Chunk-aware cap: '+maxChars+' total characters, not tile count — a "Ka" tile counts as 2</div>';
  return html;
}

function wirePassPhraseBuild(item){
  // Locked after submit — deck/slots become inert
  if(actIsSubmitted){
    const deckTrayLock = document.getElementById('ppDeckTray');
    if(deckTrayLock) deckTrayLock.querySelectorAll('[data-deck-idx]').forEach(btn=>{ btn.disabled = true; btn.style.pointerEvents='none'; btn.classList.add('is-inert'); });
    const slotsRowLock = document.getElementById('ppSlotsRow');
    if(slotsRowLock) slotsRowLock.querySelectorAll('[data-filled]').forEach(el=>{ el.style.pointerEvents='none'; });
    return;
  }
  const deckTray = document.getElementById('ppDeckTray');
  const slotsRow = document.getElementById('ppSlotsRow');
  if(deckTray){
    deckTray.querySelectorAll('[data-deck-idx]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if(actIsSubmitted) return;
        const idx = Number(btn.dataset.deckIdx);
        if(!item._ppDeckAvailable[idx]) return;
        // Enforce char cap even for selection preview — grey out if would exceed
        const maxChars = item._ppMaxChars || item.maxChars || 20;
        const curChars = item._ppSlots.join('').length;
        const chunk = item.deck[idx];
        // Only prevent selection if already at cap; allow deselection
        if(item._ppSelectedDeckIdx!==idx && curChars + String(chunk).length > maxChars){
          // flash the count? just ignore tap — cap reached
          return;
        }
        // Tap the same tile again to deselect it without placing.
        item._ppSelectedDeckIdx = (item._ppSelectedDeckIdx===idx) ? null : idx;
        renderActivityItem();
      });
    });
  }
  if(slotsRow){
    // Filled tiles: tapping one removes it via splice (not a null-out) — everything after it
    // shifts down automatically, so the row can never show a gap where a chunk was.
    slotsRow.querySelectorAll('[data-filled]').forEach(el=>{
      el.addEventListener('click', ()=>{
        if(actIsSubmitted) return;
        const idx = Number(el.dataset.slotIdx);
        const ch = item._ppSlots[idx];
        item._ppSlots.splice(idx, 1);
        for(let i=0;i<item.deck.length;i++){ if(!item._ppDeckAvailable[i] && item.deck[i]===ch){ item._ppDeckAvailable[i]=true; break; } }
        renderActivityItem();
        ppSubmitBuild(item);
      });
    });
    // Empty slots are interchangeable — whichever one is tapped, a selected deck chunk always
    // appends to the end of the placed sequence, never at the tapped button's own position, so
    // placement order always matches the order chunks were actually picked.
    slotsRow.querySelectorAll('.pp-slot-empty').forEach(el=>{
      el.addEventListener('click', ()=>{
        if(actIsSubmitted) return;
        if(item._ppSelectedDeckIdx==null) return; // nothing selected — tapping an empty slot alone does nothing
        const dIdx = item._ppSelectedDeckIdx;
        const chunk = item.deck[dIdx];
        const maxChars = item._ppMaxChars || item.maxChars || 20;
        const curChars = item._ppSlots.join('').length;
        if(curChars + String(chunk).length > maxChars) return;
        item._ppSlots.push(chunk);
        item._ppDeckAvailable[dIdx] = false;
        item._ppSelectedDeckIdx = null;
        renderActivityItem();
        ppSubmitBuild(item);
      });
    });
  }
}
function renderGenericItem(item){
  const picked = item.myAnswer;
  return '<div class="prompt">'+esc(item.prompt||'')+'</div>'
    + '<div class="options">' + (item.options||[]).map(opt=>{
        const sel = picked!=null && String(picked)===String(opt.id);
        return '<button type="button" class="option-btn'+(sel?' selected picked':'')+'" data-answer-opt="'+esc(opt.id)+'">'+esc(opt.text)+'</button>';
      }).join('') + '</div>' + renderCorrectFeedback(item);
}
const ACTIVITY_RENDERERS = {
  'fault-finding': renderFaultFinding,
  'myth-vs-fact': renderMythVsFact,
  'decision-room': renderDecisionRoom,
  'closing-quiz': renderClosingQuiz,
  'clue-quest': renderClueQuest,
  'pass-phrase': renderPassPhrase,
};

// --- Crossword compact ---
function cwKey(r,c){ return r+','+c; }
function cwBuildModel(data){
  cwRows = data.grid.rows;
  cwCols = data.grid.cols;
  cwWords = data.grid.placements.map((p,i)=> Object.assign({}, p, {index:i}));
  cwCells.clear();
  cwWords.forEach(w=>{
    for(let i=0;i<w.answer.length;i++){
      const r = w.direction==='down' ? w.row+i : w.row;
      const c = w.direction==='across' ? w.col+i : w.col;
      const k = cwKey(r,c);
      let cell = cwCells.get(k);
      if(!cell) cell = {row:r,col:c,solution:w.answer[i],across:null,down:null,number:null};
      cell[w.direction]=w.index;
      if(i===0) cell.number=w.number;
      cwCells.set(k, cell);
    }
  });
}
function cwRenderGrid(){
  // Fill available width per cell, but never shrink below a tappable floor. This grid is
  // 20x20 — plain 1fr tracks compress to ~14px/cell on a 375px phone (unusable to tap), and
  // minmax(...,1fr) alone doesn't help here: a block-level grid's "auto" width just fills its
  // parent, so fr tracks still get squeezed to fit rather than growing the box. Fixed px
  // tracks avoid that ambiguity — once the grid's true content width (cols * cellPx) exceeds
  // the wrap, .cw-grid-wrap's overflow:auto takes over with a horizontal scroll instead of
  // squeezing cells below CELL_MIN.
  const CELL_MIN = 32, GAP = 1;
  const wrapEl = els.cwGrid.parentElement;
  const availWidth = (wrapEl ? wrapEl.clientWidth - 16 : 280); // minus .cw-grid-wrap's 8px+8px padding
  const fitCell = Math.floor((availWidth - (cwCols - 1) * GAP) / cwCols);
  const cellPx = Math.max(CELL_MIN, fitCell);
  els.cwGrid.style.gridTemplateColumns = 'repeat('+cwCols+', '+cellPx+'px)';
  els.cwGrid.style.gridTemplateRows = 'repeat('+cwRows+', '+cellPx+'px)';
  els.cwGrid.style.width = (cwCols * cellPx + (cwCols - 1) * GAP) + 'px';
  els.cwGrid.innerHTML = '';
  for(let r=0;r<cwRows;r++){
    for(let c=0;c<cwCols;c++){
      const k = cwKey(r,c);
      const cell = cwCells.get(k);
      const el = document.createElement('div');
      el.className = 'cw-cell';
      if(!cell){
        el.classList.add('cw-block');
        el.setAttribute('aria-hidden','true');
        els.cwGrid.appendChild(el);
        continue;
      }
      if(cell.number){
        const num = document.createElement('span');
        num.className = 'cw-num';
        num.textContent = cell.number;
        el.appendChild(num);
      }
      const input = document.createElement('input');
      input.className = 'cw-input';
      input.maxLength = 1;
      input.autocomplete='off';
      input.spellcheck=false;
      input.dataset.row=String(r);
      input.dataset.col=String(c);
      el.appendChild(input);
      els.cwGrid.appendChild(el);
      cell.el = el;
      cell.input = input;
      // wire
      let reclick=false;
      input.addEventListener('mousedown', ()=>{ reclick = (cwCurrentRow===r && cwCurrentCol===c); });
      input.addEventListener('focus', ()=>{
        if(reclick){ const other = cwCurrentDir==='across'?'down':'across'; if(cell[other]!=null) cwCurrentDir=other; cwHighlight(); }
        else cwSelect(r,c, cwPendingDir);
        cwPendingDir=null;
      });
      input.addEventListener('click', ()=>{ reclick=false; });
      input.addEventListener('blur', ()=> scheduleCwProgress());
      input.addEventListener('input', ()=> scheduleCwProgress());
      input.addEventListener('keydown', (e)=> cwHandleKey(e, cell, input));
    }
  }
}
function cwHandleKey(e, cell, input){
  if(cwIsSubmitted){ e.preventDefault(); return; }
  if(cwRevealed){ e.preventDefault(); return; }
  if(/^[a-zA-Z]$/.test(e.key)){
    e.preventDefault();
    input.value = e.key.toUpperCase();
    clearCwMark(cell);
    // Live per-keystroke feedback: confirm correct immediately (green), but a wrong letter
    // stays neutral rather than turning red — mid-puzzle typing shouldn't read as a penalty,
    // only the explicit Check button marks wrong cells red.
    if(input.value === cell.solution) cell.el.classList.add('correct');
    const nxt = cwNeighbor(cell, cwCurrentDir, 1);
    if(nxt) cwFocus(nxt.row, nxt.col, cwCurrentDir);
    cwUpdateStatus();
    return;
  }
  switch(e.key){
    case 'Backspace':
      e.preventDefault();
      if(input.value){ input.value=''; clearCwMark(cell); }
      else { const prev=cwNeighbor(cell,cwCurrentDir,-1); if(prev){ prev.input.value=''; clearCwMark(prev); cwFocus(prev.row, prev.col, cwCurrentDir); } }
      cwUpdateStatus(); break;
    case 'Delete': e.preventDefault(); input.value=''; clearCwMark(cell); cwUpdateStatus(); break;
    case 'ArrowLeft': e.preventDefault(); cwMoveFree(cell.row,cell.col,0,-1,'across'); break;
    case 'ArrowRight': e.preventDefault(); cwMoveFree(cell.row,cell.col,0,1,'across'); break;
    case 'ArrowUp': e.preventDefault(); cwMoveFree(cell.row,cell.col,-1,0,'down'); break;
    case 'ArrowDown': e.preventDefault(); cwMoveFree(cell.row,cell.col,1,0,'down'); break;
    case 'Enter': case ' ': e.preventDefault(); { const other=cwCurrentDir==='across'?'down':'across'; if(cell[other]!=null) cwCurrentDir=other; cwHighlight(); } break;
  }
}
function cwMoveFree(r,c,dr,dc,dir){
  let nr=r+dr,nc=c+dc;
  while(nr>=0&&nr<cwRows&&nc>=0&&nc<cwCols){
    if(cwCells.has(cwKey(nr,nc))){ cwFocus(nr,nc,dir); return; }
    nr+=dr; nc+=dc;
  }
}
function cwNeighbor(cell,dir,step){
  const idx=cell[dir];
  if(idx==null) return null;
  const r=dir==='down'?cell.row+step:cell.row;
  const c=dir==='across'?cell.col+step:cell.col;
  const nxt=cwCells.get(cwKey(r,c));
  if(nxt && nxt[dir]===idx) return nxt;
  return null;
}
function cwFocus(r,c,dir){
  const cell=cwCells.get(cwKey(r,c));
  if(!cell) return;
  cwPendingDir=dir;
  // preventScroll: true — without it, focusing a cell that's off the visible edge of the
  // horizontally-scrollable grid (see cwRenderGrid) triggers the browser's own "scroll this
  // into view" behavior, which on mobile can yank the whole page/grid far out of position
  // (especially once the on-screen keyboard is also resizing the viewport). The grid's own
  // .cw-grid-wrap scroll container is already sized correctly — we don't want the browser's
  // default scroll-into-view fighting it on every keystroke's auto-advance-to-next-cell.
  cell.input.focus({preventScroll: true});
}
function cwSelect(r,c,forceDir){
  const cell=cwCells.get(cwKey(r,c));
  if(!cell) return;
  cwCurrentRow=r; cwCurrentCol=c;
  if(forceDir && cell[forceDir]!=null) cwCurrentDir=forceDir;
  else if(cell[cwCurrentDir]!=null){} else cwCurrentDir=cell.across!=null?'across':'down';
  cwHighlight();
}
function cwHighlight(){
  cwCells.forEach(cell=> cell.el.classList.remove('active-cell','active-word'));
  document.querySelectorAll('#cwAcross li.active, #cwDown li.active').forEach(li=> li.classList.remove('active'));
  const cell=cwCells.get(cwKey(cwCurrentRow,cwCurrentCol));
  if(!cell) return;
  cell.el.classList.add('active-cell');
  const idx=cell[cwCurrentDir];
  if(idx!=null){
    const w=cwWords[idx];
    for(let i=0;i<w.answer.length;i++){
      const r=w.direction==='down'?w.row+i:w.row;
      const c=w.direction==='across'?w.col+i:w.col;
      const wc=cwCells.get(cwKey(r,c));
      if(wc) wc.el.classList.add('active-word');
    }
    const li=document.querySelector('.cw-clue-list li[data-index="'+idx+'"]');
    if(li){ li.classList.add('active'); li.scrollIntoView({block:'nearest'}); }
  }
}
function clearCwMark(cell){ cell.el.classList.remove('correct','incorrect'); }
function cwRenderClues(){
  const across=cwWords.filter(w=>w.direction==='across').sort((a,b)=>a.number-b.number);
  const down=cwWords.filter(w=>w.direction==='down').sort((a,b)=>a.number-b.number);
  const render=(list,target)=>{
    // Hint is opt-in per clue: a small button that reveals just the first letter as a text
    // line, never shown by default and never touching the grid — tapping it can't be mistaken
    // for auto-filling progress, it's purely a nudge.
    target.innerHTML = list.map(w=> '<li data-index="'+w.index+'"><span class="cw-clue-num">'+w.number+'.</span>'+esc(w.clue)
      + '<button type="button" class="cw-hint-btn" data-hint-idx="'+w.index+'"><i class="fa-solid fa-lightbulb"></i> Hint</button>'
      + '<span class="cw-hint-text hidden" data-hint-text-idx="'+w.index+'">Starts with "'+esc(w.answer[0])+'"</span></li>').join('');
    Array.from(target.children).forEach(li=>{
      li.addEventListener('click', ()=>{
        const w=cwWords[Number(li.dataset.index)];
        cwFocus(w.row,w.col,w.direction);
      });
    });
    target.querySelectorAll('.cw-hint-btn').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        e.stopPropagation();
        const idx = btn.dataset.hintIdx;
        const span = target.querySelector('[data-hint-text-idx="'+idx+'"]');
        if(span) span.classList.remove('hidden');
        btn.disabled = true;
      });
    });
  };
  render(across, els.cwAcross);
  render(down, els.cwDown);
}
function cwUpdateStatus(){
  if(cwRevealed) return;
  let filled=0;
  cwCells.forEach(cell=>{ if(cell.input && cell.input.value) filled++; });
  els.cwStatus.textContent = filled + ' of ' + cwCells.size + ' letters filled';
  scheduleCwProgress();
}
function cwCheck(){
  if(cwIsSubmitted) return;
  cwCells.forEach(cell=>{
    if(!cell.input.value) return;
    if(cell.input.value===cell.solution){ cell.el.classList.add('correct'); cell.el.classList.remove('incorrect'); }
    else { cell.el.classList.add('incorrect'); cell.el.classList.remove('correct'); }
  });
  // mark clues solved
  cwWords.forEach(w=>{
    let solved=true;
    for(let i=0;i<w.answer.length;i++){
      const r=w.direction==='down'?w.row+i:w.row;
      const c=w.direction==='across'?w.col+i:w.col;
      const cell=cwCells.get(cwKey(r,c));
      if(!cell || cell.input.value!==cell.solution){ solved=false; break; }
    }
    const li=document.querySelector('.cw-clue-list li[data-index="'+w.index+'"]');
    if(li) li.classList.toggle('solved', solved);
  });
  cwUpdateStatus();
}
function cwReveal(){
  cwRevealed=true;
  cwCells.forEach(cell=>{
    cell.input.value=cell.solution;
    cell.input.readOnly=true;
    cell.el.classList.remove('correct','incorrect');
    cell.el.classList.add('revealed');
  });
  document.querySelectorAll('.cw-clue-list li').forEach(li=> li.classList.add('solved'));
  els.cwStatus.textContent='Answers revealed';
  scheduleCwProgress();
  setTimeout(sendCwProgress, 200);
}
function computeCwProgress(){
  const total=cwWords.length||0;
  if(!total) return {filled:0,total:0,correct:0};
  let filled=0, correct=0;
  for(const w of cwWords){
    let all=true, allCorrect=true;
    for(let i=0;i<w.answer.length;i++){
      const r=w.direction==='down'?w.row+i:w.row;
      const c=w.direction==='across'?w.col+i:w.col;
      const cell=cwCells.get(cwKey(r,c));
      if(!cell || !cell.input || !cell.input.value.trim()){ all=false; allCorrect=false; break; }
      if(cell.input.value.trim().toUpperCase() !== cell.solution) allCorrect=false;
    }
    if(all) filled++;
    // correct entries are those where every cell matches solution (implies filled)
    let ok=true;
    for(let i=0;i<w.answer.length;i++){
      const r=w.direction==='down'?w.row+i:w.row;
      const c=w.direction==='across'?w.col+i:w.col;
      const cell=cwCells.get(cwKey(r,c));
      if(!cell || !cell.input || cell.input.value.trim().toUpperCase() !== cell.solution){ ok=false; break; }
    }
    if(ok) correct++;
  }
  return {filled,total,correct};
}
async function sendCwProgress(){
  if(cwIsSubmitted) return;
  if(!participantId || !ROOM_CODE) return;
  if(document.getElementById('crosswordScreen').classList.contains('hidden')) return;
  const {filled,total,correct}=computeCwProgress();
  if(cwLastSent && cwLastSent.filled===filled && cwLastSent.total===total && cwLastSent.correct===correct) return;
  cwLastSent={filled,total,correct};
  try{
    await fetch('/api/session/'+ROOM_CODE+'/crossword/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({participantId:participantId, filledCount:filled, totalCount:total, correctCount:correct})});
  }catch(e){}
}
function scheduleCwProgress(){
  if(cwIsSubmitted) return;
  if(!participantId) return;
  if(cwProgressTimer) clearTimeout(cwProgressTimer);
  cwProgressTimer=setTimeout(sendCwProgress, CW_DEBOUNCE);
}
async function ensureCrossword(){
  if(cwInitialized) return;
  cwInitialized = true;
  els.cwStatus.textContent='Loading grid…';
  try{
    const r=await fetch('/live-event/content/crossword.json',{cache:'no-store'});
    const data=await r.json();
    cwBuildModel(data);
    if(els.cwClueCountBadge) els.cwClueCountBadge.textContent = 'Crossword · ' + cwWords.length + ' clues';
    cwRenderGrid();
    cwRenderClues();
    cwUpdateStatus();
    // wire check/reveal
    els.cwCheck.addEventListener('click', cwCheck);
    els.cwReveal.addEventListener('click', cwReveal);
    scheduleCwProgress();
  }catch(e){
    els.cwStatus.textContent='Failed to load grid';
  }
}

// --- State polling — whole-activity flow (lobby/running/complete) ---
async function fetchState(){
  const mySeq = ++fetchSeq;
  try{
    const r=await fetch('/api/session/' + ROOM_CODE + '/state?participantId=' + encodeURIComponent(participantId||''), {cache:'no-store'});
    if(mySeq !== fetchSeq) return; // a newer poll started while this one was in flight — stale, discard
    if(r.status===404){
      // Covers the brief window right after a server restart where the process is back up
      // (persisted sessions reloading, or this poll landing before that finishes) but the
      // room isn't resolvable yet — retry a few times with a calm indicator before concluding
      // the room is genuinely gone, instead of dead-ending on the very first 404.
      notFoundCount++;
      if(notFoundCount<=NOT_FOUND_RETRY_LIMIT){
        els.reconnectBanner.classList.remove('hidden');
        return;
      }
      showScreen('error');
      els.errorMsg.textContent = 'This session has ended or the room code is wrong. Please check with the facilitator or ask for a new QR.';
      stopPolling();
      return;
    }
    if(!r.ok){
      const j=await r.json().catch(()=>({}));
      throw new Error(j.error || 'State fetch failed');
    }
    const s=await r.json();
    notFoundCount=0;
    retryCount=0;
    els.reconnectBanner.classList.add('hidden');
    updateHeaderCount(s.participantCount||0);
    const curMod = s.activeModule || null;
    const state = s.state || null;
    const displayName = s.displayName || curMod || '—';

    // No module yet — waiting for host to pick
    if(!curMod || !state){
      actModuleLoaded = null; // so relaunching any module later re-initializes the activity
      showScreen('waiting');
      els.waitingModule.textContent = 'No active activity';
      document.getElementById('waitingSub').textContent = "You're in. Waiting for the facilitator to pick an activity.";
      els.waitingNames.innerHTML = (s.participantNames||[]).map(n=>'<span class="badge">'+esc(n)+'</span>').join('') || '<span style="font-size:12px;color:#94a3b8">Share the room code to invite others</span>';
      return;
    }
    // Lobby — module chosen but not yet started, show waiting for start with module name
    if(state==='lobby'){
      actModuleLoaded = null; // clears the PREVIOUS activity's local state before Start
      showScreen('waiting');
      els.waitingModule.textContent = displayName + ' — lobby';
      document.getElementById('waitingSub').textContent = "You're in — waiting for the facilitator to start " + displayName;
      // Live joined count explicitly tied to chosen module
      els.waitingNames.innerHTML = '<div style="font-size:13px;color:#0c4a6e;font-weight:700;margin-bottom:6px">' + esc(displayName) + ' — ' + (s.totalItems||0) + ' items</div><div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center">' + ((s.participantNames||[]).map(n=>'<span class="badge">'+esc(n)+'</span>').join('') || '<span style="font-size:12px;color:#94a3b8">No one yet — share QR</span>') + '</div><div style="margin-top:8px;font-family:Space Mono,monospace;font-size:11px;color:#64748b">' + (s.participantCount||0) + ' joined — waiting for Start</div>';
      return;
    }
    // Capture per-participant submission status + rememberThis for submitted confirmation
    lastRememberThis = s.rememberThis || null;
    mySubmission = s.mySubmission || null;
    actIsSubmitted = !!(mySubmission && mySubmission.isSubmitted && MC_MODULES.includes(mySubmission.module) && mySubmission.module===curMod);
    cwIsSubmitted = !!(mySubmission && mySubmission.isSubmitted && mySubmission.module==='crossword' && curMod==='crossword');
    // If already submitted for this running module, show locked confirmation (distinct from generic complete)
    // — unless participant tapped Review, in which case keep them on the read-only item view with facts.
    if(state==='running' && mySubmission && mySubmission.isSubmitted && mySubmission.module===curMod && !isReviewingAfterSubmit){
      showSubmittedFor(curMod, mySubmission.submittedAt);
      // Ensure crossword grid is locked if it's the crossword module
      if(curMod==='crossword'){
        actModuleLoaded = null;
        // ensure grid exists then lock
        ensureCrossword();
        setTimeout(()=>{ cwCells.forEach(cell=>{ if(cell.input) cell.input.readOnly = true; }); updateCwSubmitVisibility(); }, 300);
      }
      return;
    }
    // Running — crossword's own dedicated grid, or the self-paced full-sequence activity
    // Flow parity with console: intro/whyThisMatters before items (console le-intro-screen)
    if(state==='running'){
      if(curMod==='crossword'){
        if(showParticipantIntro(curMod, s.whyThisMatters)) return;
        actModuleLoaded = null;
        showScreen('crossword');
        ensureCrossword();
        // Update submit visibility after grid ensured; handle review mode
        setTimeout(()=>{
          updateCwSubmitVisibility();
          if(isReviewingAfterSubmit && cwIsSubmitted){
            if(els.cwReviewBackWrap) els.cwReviewBackWrap.classList.remove('hidden');
            if(els.cwSubmitWrap) els.cwSubmitWrap.classList.add('hidden');
            cwCells.forEach(cell=>{ if(cell.input) cell.input.readOnly = true; });
          } else {
            if(els.cwReviewBackWrap) els.cwReviewBackWrap.classList.add('hidden');
          }
        }, 400);
        return;
      }
      if(MC_MODULES.includes(curMod)){
        const items = s.items || [];
        if(!items.length){
          showScreen('waiting');
          els.waitingModule.textContent = displayName + ' — running';
          document.getElementById('waitingSub').textContent = 'Running ' + displayName + ' — no items to show.';
          return;
        }
        if(showParticipantIntro(curMod, s.whyThisMatters)) return;
        showScreen('activity');
        // Review mode: keep activity visible with facts, hide Submit, show Back to Confirmation
        if(isReviewingAfterSubmit && actIsSubmitted){
          if(els.reviewBackWrap) els.reviewBackWrap.classList.remove('hidden');
          if(els.actSubmitWrap) els.actSubmitWrap.classList.add('hidden');
        } else {
          if(els.reviewBackWrap) els.reviewBackWrap.classList.add('hidden');
        }
        // Only (re)initialize on an actual module change — a poll tick for the SAME module
        // must never re-run this, or it would reset the participant's own Prev/Next position
        // and interrupt any in-progress tap (see initActivity's own comment).
        if(actModuleLoaded !== curMod){
          initActivity(curMod, items);
        } else {
          // Same module — but items may have updated myAnswer/myBuild from server (e.g. after refresh)
          // Sync local actItems with fresh server items to keep submit visibility accurate,
          // without resetting actIndex. Also propagate fact (identification+recommendation) now visible after Submit.
          if(items.length === actItems.length){
            for(let i=0;i<items.length;i++){
              actItems[i].myAnswer = items[i].myAnswer;
              actItems[i].myAnswerCorrect = items[i].myAnswerCorrect;
              actItems[i].myBuild = items[i].myBuild;
              actItems[i].fact = items[i].fact;
              actItems[i].revealed = items[i].revealed;
            }
            // Re-render current item so fact detail appears in review mode
            if(isReviewingAfterSubmit && actIsSubmitted) renderActivityItem();
            else updateActivitySubmitVisibility();
          }
        }
        return;
      }
    }
    // Complete — same room stays, waiting for next pick
    if(state==='complete'){
      actModuleLoaded = null;
      showScreen('complete');
      if(els.completeModule) els.completeModule.textContent = displayName;
      return;
    }
    // Idle — host has returned to the picker after completion, next activity not chosen yet.
    // Same lobby-style "waiting for host" message as the no-module-yet case, but distinct
    // from it so the room/activity history isn't implied to be reset.
    if(state==='idle'){
      actModuleLoaded = null;
      showScreen('waiting');
      els.waitingModule.textContent = 'Choosing next activity';
      document.getElementById('waitingSub').textContent = "You're in — waiting for the facilitator to choose the next activity.";
      els.waitingNames.innerHTML = (s.participantNames||[]).map(n=>'<span class="badge">'+esc(n)+'</span>').join('') || '<span style="font-size:12px;color:#94a3b8">Share the room code to invite others</span>';
      return;
    }
    // Fallback
    showScreen('waiting');
    els.waitingModule.textContent = displayName;
    document.getElementById('waitingSub').textContent = 'Waiting…';
  }catch(e){
    if(mySeq !== fetchSeq) return;
    // Network-level failures (offline, DNS, etc.) — 404 is handled above and never reaches here.
    retryCount++;
    if(retryCount>=2) els.reconnectBanner.classList.remove('hidden');
  }
}
function startPolling(){
  if(pollTimer) clearInterval(pollTimer);
  fetchState();
  pollTimer = setInterval(fetchState, 1500);
}
function stopPolling(){ if(pollTimer){ clearInterval(pollTimer); pollTimer=null; } }

// Init: resume or join
(function init(){
  if(participantId && participantName){
    // Resumed session (survives refresh/sleep)
    showScreen('waiting');
    startPolling();
  }else{
    showScreen('join');
    els.nameInput.focus();
  }
  els.joinBtn.addEventListener('click', doJoin);
  els.nameInput.addEventListener('keydown', e=>{ if(e.key==='Enter') doJoin(); });
  els.retryBtn.addEventListener('click', ()=>{
    if(participantId) { startPolling(); showScreen('waiting'); }
    else showScreen('join');
    els.errorScreen.classList.add('hidden');
  });
})();
</script>
</body>
</html>"""
    html = html_template.replace("__ROOM_CODE__", code)
    return Response(html, mimetype="text/html")


@app.route("/api/session/<code>/join", methods=["POST"])
@limiter.limit("30/minute")
@persist_after
def session_join(code):
    code = code.strip().upper()
    sess = SESSIONS.get(code)
    if not sess:
        return jsonify({"error": "room not found"}), 404
    data = request.get_json(silent=True) or {}
    # Accept {name} or form or raw string
    name = data.get("name") if isinstance(data, dict) else None
    if not name:
        # try form
        name = request.form.get("name")
    if not name and isinstance(data, str):
        name = data
    if not name:
        # try query
        name = request.args.get("name")
    if not name or not str(name).strip():
        return jsonify({"error": "name required"}), 400
    name = str(name).strip()[:40]
    pid = _gen_id("p_")
    # Ensure uniqueness (very low collision)
    while pid in sess["participants"]:
        pid = _gen_id("p_")
    sess["participants"][pid] = name
    sess["participantMeta"][pid] = {"name": name, "joinedAt": datetime.now(timezone.utc).isoformat()}
    return jsonify({"participantId": pid, "roomCode": code, "name": name})


@app.route("/api/admin/modules", methods=["GET"])
@admin_required
def admin_modules():
    """List 7 modules with item counts read live from content/*.json."""
    mods = _get_modules_with_counts()
    return jsonify({"modules": mods, "total": len(mods)})


@app.route("/api/admin/modules/<module_id>/facilitator-notes", methods=["GET"])
@admin_required
def admin_facilitator_notes(module_id):
    """Admin-only talking points for a module: whyThisMatters plus facilitatorNotes (2-3
    discussion prompts + the one most commonly-missed item), read straight from that module's
    own content/*.json. Static per-module content, not session state — keyed by module id alone
    so the dashboard can show it as soon as a module starts running, no room-specific lookup
    needed. Deliberately never referenced by any participant-facing route or template; the only
    caller is the admin dashboard's own Facilitator Notes panel (see loadFacilitatorNotes in
    admin/dashboard.html)."""
    module_id = str(module_id).strip()
    if module_id not in MODULE_IDS:
        return jsonify({"error": "unknown module", "valid": sorted(MODULE_IDS)}), 400
    data = _read_module_json(module_id)
    if not data:
        return jsonify({"error": "content not found"}), 404
    return jsonify({
        "module": module_id,
        "whyThisMatters": data.get("whyThisMatters"),
        "facilitatorNotes": data.get("facilitatorNotes"),
    })


@app.route("/api/admin/session/<code>/launch", methods=["POST"])
@admin_required
@persist_after
def admin_launch(code):
    """Whole-activity launch: pick module, load its full sequence server-side, set lobby.

    Generates room+QR is handled by /api/session/create; this reuses existing room if open.
    Sets state=lobby, activeModule chosen, sequence pre-loaded, not yet started.
    Participants joining during lobby see 'waiting for host to start [Module]'.
    """
    code = code.strip().upper()
    sess = SESSIONS.get(code)
    if not sess:
        return jsonify({"error": "room not found"}), 404
    data = request.get_json(silent=True) or {}
    module = data.get("module") or data.get("activeModule") or request.form.get("module") or ""
    module = str(module).strip()
    if not module:
        return jsonify({"error": "module required"}), 400
    if module not in MODULE_IDS:
        return jsonify({"error": "unknown module", "valid": sorted(MODULE_IDS)}), 400
    seq = _load_module_sequence(module)
    # Backwards compat: ensure new state fields exist for old sessions
    sess.setdefault("moduleSequence", [])
    sess.setdefault("state", None)
    sess.setdefault("currentItemIndex", None)
    sess["activeModule"] = module
    sess["state"] = "lobby"
    sess["moduleSequence"] = seq
    sess["currentItemIndex"] = None
    sess["activeItem"] = None
    # Keep participants/responses/crosswordProgress for same-room reuse; launch does not wipe them
    return jsonify({
        "ok": True,
        "roomCode": code,
        "activeModule": module,
        "state": "lobby",
        "itemCount": len(seq),
        "joinUrl": _get_join_url(code),
    })


@app.route("/api/admin/session/<code>/start", methods=["POST"])
@admin_required
@persist_after
def admin_start(code):
    """Start lobby -> running. Requires >=1 participant, pushes item 0."""
    code = code.strip().upper()
    sess = SESSIONS.get(code)
    if not sess:
        return jsonify({"error": "room not found"}), 404
    # Ensure state fields
    sess.setdefault("state", None)
    sess.setdefault("moduleSequence", [])
    sess.setdefault("currentItemIndex", None)
    if sess.get("state") != "lobby":
        return jsonify({"error": "not in lobby", "state": sess.get("state")}), 400
    if len(sess.get("participants", {})) < 1:
        return jsonify({"error": "need at least 1 participant to start"}), 400
    module = sess.get("activeModule")
    seq = sess.get("moduleSequence") or []
    # For crossword (self-paced), running has no discrete next sequence — grid unlocked
    if module == "crossword":
        sess["state"] = "running"
        sess["currentItemIndex"] = 0
        # Keep single grid item as activeItem for consistency, but participant grid is shown via module
        sess["activeItem"] = seq[0] if seq else None
        # Ensure response bucket if needed
        if sess["activeItem"] and sess["activeItem"].get("id") and sess["activeItem"]["id"] not in sess["responses"]:
            sess["responses"][sess["activeItem"]["id"]] = {}
        return jsonify({"ok": True, "roomCode": code, "state": "running", "activeModule": module, "currentItem": sess["activeItem"], "currentIndex": 0, "total": len(seq)})
    if not seq:
        return jsonify({"error": "no items for module"}), 400
    sess["state"] = "running"
    sess["currentItemIndex"] = 0
    sess["activeItem"] = seq[0]
    # Ensure bucket
    if seq[0].get("id") not in sess["responses"]:
        sess["responses"][seq[0]["id"]] = {}
    return jsonify({"ok": True, "roomCode": code, "state": "running", "activeModule": module, "currentItem": sess["activeItem"], "currentIndex": 0, "total": len(seq)})


@app.route("/api/admin/session/<code>/next", methods=["POST"])
@admin_required
@persist_after
def admin_next(code):
    """Advance the admin's own item pointer (used for narration/reveal — for the 6 self-paced
    modules this no longer gates what participants can answer, since /start already pushed the
    full sequence to every phone) -> next item, or jump straight to complete.

    For self-paced modules the admin typically won't want to click Next once per item just to
    reach the end — pass {"complete": true} to mark the activity complete directly (e.g. once
    the per-participant progress panel shows everyone finished), instead of walking the whole
    sequence one step at a time.
    """
    code = code.strip().upper()
    sess = SESSIONS.get(code)
    if not sess:
        return jsonify({"error": "room not found"}), 404
    sess.setdefault("state", None)
    sess.setdefault("moduleSequence", [])
    sess.setdefault("currentItemIndex", None)
    if sess.get("state") != "running":
        return jsonify({"error": "not running", "state": sess.get("state")}), 400
    data = request.get_json(silent=True) or {}
    if data.get("complete"):
        sess["state"] = "complete"
        sess["currentItemIndex"] = None
        sess["activeItem"] = None
        return jsonify({"ok": True, "roomCode": code, "state": "complete", "activeModule": sess["activeModule"]})
    seq = sess.get("moduleSequence") or []
    idx = sess.get("currentItemIndex")
    if idx is None:
        idx = 0
    else:
        idx += 1
    # Crossword: any next ends the activity (self-paced)
    if sess.get("activeModule") == "crossword":
        sess["state"] = "complete"
        sess["currentItemIndex"] = None
        # Keep activeItem as grid or None
        return jsonify({"ok": True, "roomCode": code, "state": "complete", "activeModule": sess["activeModule"]})
    if idx >= len(seq):
        sess["state"] = "complete"
        sess["currentItemIndex"] = None
        sess["activeItem"] = None
        return jsonify({"ok": True, "roomCode": code, "state": "complete", "activeModule": sess["activeModule"]})
    sess["currentItemIndex"] = idx
    sess["activeItem"] = seq[idx]
    if seq[idx].get("id") not in sess["responses"]:
        sess["responses"][seq[idx]["id"]] = {}
    return jsonify({"ok": True, "roomCode": code, "state": "running", "activeModule": sess["activeModule"], "currentItem": sess["activeItem"], "currentIndex": idx, "total": len(seq)})


@app.route("/api/admin/session/<code>/return-to-picker", methods=["POST"])
@admin_required
@persist_after
def admin_return_to_picker(code):
    """Explicit server-side transition out of a completed activity, back to the module picker.

    Replaces the old client-only "Choose Next Activity" DOM toggle: that never updated
    server state, so state stayed "complete" while the operator was picking the next
    module, and every 1.5s poll tick re-synced the dashboard back to the finished
    module's completion panel. Requires state=="complete". Leaves participants/
    participantMeta/responses/crosswordProgress untouched, same as launch — same room
    stays joined, no re-scan.
    """
    code = code.strip().upper()
    sess = SESSIONS.get(code)
    if not sess:
        return jsonify({"error": "room not found"}), 404
    if sess.get("state") != "complete":
        return jsonify({"error": "not complete", "state": sess.get("state")}), 400
    sess["state"] = "idle"
    sess["currentItemIndex"] = None
    sess["activeItem"] = None
    return jsonify({"ok": True, "roomCode": code, "state": "idle", "activeModule": sess.get("activeModule")})


@app.route("/api/admin/session/<code>/item", methods=["POST"])
@admin_required
def admin_item(code):
    """Deprecated: whole-activity flow now pulls items from content/*.json via launch/start/next.
    Kept for backwards compatibility but returns 410. Use POST /launch {module} -> POST /start -> POST /next."""
    return jsonify({
        "error": "deprecated",
        "message": "POST /item {prompt,options} is deprecated — items are now server-loaded from content/*.json. Use POST /launch {module} (lobby) -> POST /start -> POST /next to walk the pre-loaded sequence. See GET /api/admin/modules for counts.",
        "useInstead": ["/api/admin/modules", "/api/admin/session/<code>/launch", "/api/admin/session/<code>/start", "/api/admin/session/<code>/next"],
    }), 410


@app.route("/api/admin/session/<code>/reveal", methods=["POST"])
@admin_required
@persist_after
def admin_reveal(code):
    """Admin-screen-only reveal — shown on the facilitator's own dashboard for the room to see
    together, never sent to participant phones (see _sanitize_item_for_participant, which never
    copies fact/revealed to a participant). Optionally pass {itemId} to reveal a specific item
    in the module's full sequence directly (self-paced modules: admin's own narration pointer
    is independent of which items participants have already answered on their own phones);
    without itemId, falls back to the room's current activeItem for backwards compatibility."""
    code = code.strip().upper()
    sess = SESSIONS.get(code)
    if not sess:
        return jsonify({"error": "room not found"}), 404
    data = request.get_json(silent=True) or {}
    item_id = str(data.get("itemId") or "").strip()
    if item_id:
        module_sequence = sess.get("moduleSequence") or []
        item = next((it for it in module_sequence if it.get("id") == item_id), None)
        if not item:
            return jsonify({"error": "item not found in this activity's sequence"}), 400
    else:
        item = sess.get("activeItem")
    if not item:
        return jsonify({"error": "no active item to reveal"}), 400
    # Allow admin to set/override fact at reveal time
    if data.get("fact") is not None:
        item["fact"] = str(data.get("fact"))
    if data.get("revealText") is not None:
        item["fact"] = str(data.get("revealText"))
    if data.get("answerText") is not None:
        item["answerText"] = str(data.get("answerText"))
    # If no fact stored and myth-vs-fact, still mark revealed but fact will be absent
    item["revealed"] = True
    if not item_id:
        sess["activeItem"] = item
    return jsonify({"ok": True, "roomCode": code, "activeItem": item})


@app.route("/api/session/<code>/respond", methods=["POST"])
@limiter.limit("300/minute")
@persist_after
def session_respond(code):
    code = code.strip().upper()
    sess = SESSIONS.get(code)
    if not sess:
        return jsonify({"error": "room not found"}), 404
    # Whole-activity flow: only accept responses while running
    if sess.get("state") is not None and sess.get("state") != "running":
        return jsonify({"error": "not running", "state": sess.get("state")}), 400
    data = request.get_json(silent=True) or {}
    if not data:
        data = request.form.to_dict(flat=True)
    participant_id = data.get("participantId") or data.get("participant_id") or data.get("pid") or request.args.get("participantId") or ""
    item_id = data.get("itemId") or data.get("item_id") or data.get("id") or ""
    option_id = data.get("optionId") or data.get("option_id") or data.get("option") or data.get("choice") or ""
    participant_id = str(participant_id).strip()
    item_id = str(item_id).strip()
    option_id = str(option_id).strip()
    if not participant_id or not item_id or not option_id:
        return jsonify({"error": "participantId, itemId, optionId required"}), 400
    if participant_id not in sess["participants"]:
        return jsonify({"error": "unknown participantId"}), 404
    # Lock: after deliberate Submit, no further edits for that participant+module
    _sub = sess.get("submissions", {}).get(participant_id, {}).get(sess.get("activeModule"))
    if _sub:
        _sub_at = _sub if isinstance(_sub, str) else _sub.get("submittedAt")
        return jsonify({"error": "already submitted - answers locked", "submittedAt": _sub_at}), 403
    # Self-paced: accept a response for ANY item in the full pushed sequence, not only
    # whichever one is "active" — participants page through the whole set at their own pace,
    # not in lockstep with a single admin-driven pointer.
    module_sequence = sess.get("moduleSequence") or []
    target_item = next((it for it in module_sequence if it.get("id") == item_id), None)
    if not target_item:
        return jsonify({"error": "item not found in this activity's sequence"}), 400
    # Validate option
    valid_ids = {str(o["id"]) for o in target_item.get("options", [])}
    if option_id not in valid_ids:
        return jsonify({"error": "invalid optionId", "valid": list(valid_ids)}), 400
    # Record (overwrite allowed — last vote counts; respondedAt moves with it, so a changed
    # answer also moves the participant to their new position in admin's response-order list)
    if item_id not in sess["responses"]:
        sess["responses"][item_id] = {}
    responded_at = datetime.now(timezone.utc).isoformat()
    # moduleId tags this entry with whichever module was active when it was recorded, so a later
    # read (see _response_entries_for_module) can tell it apart from a same-named item id reused
    # by a different module launched in this same room afterward.
    sess["responses"][item_id][participant_id] = {
        "optionId": option_id, "respondedAt": responded_at, "moduleId": sess.get("activeModule"),
    }
    # Per-item correct/wrong feedback on the participant's OWN answer only — a derived boolean,
    # never the answer key itself (correctOptionId is never sent to participants anywhere else
    # either; see _sanitize_item_for_participant). Only present when the item has one.
    correct_option_id = _effective_correct_option_id(target_item, participant_id)
    is_correct = (option_id == str(correct_option_id)) if correct_option_id is not None else None
    return jsonify({"ok": True, "roomCode": code, "itemId": item_id, "optionId": option_id, "isCorrect": is_correct})


@app.route("/api/session/<code>/submit", methods=["POST"])
@limiter.limit("30/minute")
@persist_after
def session_submit(code):
    """Deliberate per-participant per-module completion — locks answers for that module.

    Participant taps 'Submit Answers' once they consider themselves done (all MC items
    answered, or builds/grid finished for pass-phrase/crossword). Records submittedAt
    per participant per module in sess['submissions'][pid][module] — this is the
    authoritative 'done' signal for admin progress / fastest-overall ranking, not just
    last-item-answered-at. After submission further calls to /respond, /passphrase/build
    or /crossword/progress for that participant+module are rejected (locked). The room's
    running/complete state is unchanged — admin's Mark Complete still moves the whole room
    to complete regardless of who has or hasn't submitted (non-submitted simply stay not
    submitted). Idempotent: resubmitting same participant+module returns original timestamp.
    """
    code = code.strip().upper()
    sess = SESSIONS.get(code)
    if not sess:
        return jsonify({"error": "room not found"}), 404
    data = request.get_json(silent=True) or {}
    if not data:
        data = request.form.to_dict(flat=True)
    participant_id = str(data.get("participantId") or data.get("participant_id") or data.get("pid") or request.args.get("participantId") or "").strip()
    module = str(data.get("module") or data.get("moduleId") or data.get("activeModule") or sess.get("activeModule") or "").strip()
    if not participant_id:
        return jsonify({"error": "participantId required"}), 400
    if not module:
        return jsonify({"error": "module required"}), 400
    if module not in MODULE_IDS:
        return jsonify({"error": "unknown module", "valid": sorted(MODULE_IDS)}), 400
    if participant_id not in sess.get("participants", {}):
        return jsonify({"error": "unknown participantId"}), 404
    # Only allow submit for the currently active module while running — but keep idempotent
    # handling so a participant who already submitted for a prior module doesn't get blocked when
    # the room later moves to a new module and old submissions remain.
    active_module = sess.get("activeModule")
    state = sess.get("state")
    if state != "running" or active_module != module:
        # Allow resubmission check before hard error — if they already submitted for this module,
        # return that record even if room has moved on.
        existing = sess.get("submissions", {}).get(participant_id, {}).get(module)
        if existing:
            # normalize stored value: may be iso string or dict with submittedAt
            submitted_at = existing if isinstance(existing, str) else existing.get("submittedAt")
            return jsonify({"ok": True, "alreadySubmitted": True, "roomCode": code, "module": module, "submittedAt": submitted_at})
        if state != "running":
            return jsonify({"error": "not running", "state": state}), 400
        if active_module != module:
            return jsonify({"error": "module mismatch", "activeModule": active_module, "requestedModule": module}), 400
    # For discrete MC modules, require every item answered before submit — this keeps the
    # three-state admin display meaningful (in_progress vs reached_end vs submitted) and
    # matches the phone UI which only enables Submit when all items have an answer.
    # Continuous modules (crossword, pass-phrase) allow submit at any point — participant
    # decides when their build/grid is "finished", not when a count is reached.
    if module in ('fault-finding','myth-vs-fact','decision-room','closing-quiz','clue-quest'):
        seq = sess.get("moduleSequence") or []
        if seq:
            answered = 0
            for _it in seq:
                _bucket = _response_entries_for_module(sess.get("responses", {}).get(_it.get("id"), {}), module)
                if _bucket.get(participant_id) is not None:
                    answered += 1
            if answered < len(seq):
                return jsonify({"error": "not all items answered", "answered": answered, "total": len(seq)}), 400
    sess.setdefault("submissions", {})
    sess["submissions"].setdefault(participant_id, {})
    existing = sess["submissions"][participant_id].get(module)
    if existing:
        submitted_at = existing if isinstance(existing, str) else existing.get("submittedAt")
        return jsonify({"ok": True, "alreadySubmitted": True, "roomCode": code, "module": module, "submittedAt": submitted_at})
    submitted_at = datetime.now(timezone.utc).isoformat()
    sess["submissions"][participant_id][module] = submitted_at
    return jsonify({"ok": True, "alreadySubmitted": False, "roomCode": code, "module": module, "submittedAt": submitted_at})


@app.route("/api/session/<code>/state", methods=["GET"])
def session_state(code):
    code = code.strip().upper()
    sess = SESSIONS.get(code)
    if not sess:
        return jsonify({"error": "room not found"}), 404
    active_module = sess.get("activeModule")
    # Backwards compat: old sessions may not have state fields
    state = sess.get("state")
    # Normalize None -> no active module
    active_item = sess.get("activeItem")
    # Optional: personalizes each item with this participant's own prior answer, so a phone
    # that navigates back to an already-answered item (self-paced full-sequence view) can show
    # their selection. Never used to leak anyone else's answers — only this participantId's own.
    participant_id = str(request.args.get("participantId") or "").strip()
    valid_participant = bool(participant_id) and participant_id in sess.get("participants", {})

    def _my_answer(item_id):
        if not valid_participant or not item_id:
            return None
        bucket = _response_entries_for_module(sess["responses"].get(item_id, {}), active_module)
        entry = bucket.get(participant_id)
        return entry.get("optionId") if isinstance(entry, dict) else entry

    def _my_build(item_id):
        # Pass-phrase's equivalent of _my_answer — their in-progress build for this round, so
        # refreshing or navigating back to a round doesn't lose what they've placed so far.
        if not valid_participant or not item_id or active_module != "pass-phrase":
            return None
        return sess.get("passphraseBuilds", {}).get(participant_id, {}).get(item_id)

    # Per-participant per-module submission status (authoritative done signal)
    my_submission = None
    my_is_submitted = False
    my_submitted_at = None
    if valid_participant and active_module:
        _sub_raw = sess.get("submissions", {}).get(participant_id, {}).get(active_module)
        if _sub_raw:
            my_is_submitted = True
            my_submitted_at = _sub_raw if isinstance(_sub_raw, str) else _sub_raw.get("submittedAt")
            my_submission = {"isSubmitted": True, "submittedAt": my_submitted_at, "module": active_module}
        else:
            my_submission = {"isSubmitted": False, "submittedAt": None, "module": active_module}

    safe_item = _sanitize_item_for_participant(
        active_item, active_module,
        my_answer=_my_answer(active_item["id"]) if active_item else None,
        my_build=_my_build(active_item["id"]) if active_item else None,
        participant_id=participant_id if valid_participant else None,
        is_submitted=my_is_submitted,
    )
    # For whole-activity flow, currentItem is only while running; lobby/complete have no currentItem
    current_item = safe_item if state == "running" else None

    # Self-paced full push: once running, participants get every item in the sequence at once
    # and page through it locally at their own pace (submitting each answer as they go via
    # /respond) instead of waiting for an admin-pushed single "next" item. Crossword still
    # ignores this (it has its own dedicated grid-fetch flow) — harmless to include regardless.
    module_sequence = sess.get("moduleSequence") or []
    items = None
    if state == "running":
        items = [
            _sanitize_item_for_participant(
                it, active_module, my_answer=_my_answer(it.get("id")), my_build=_my_build(it.get("id")),
                participant_id=participant_id if valid_participant else None,
                is_submitted=my_is_submitted,
            )
            for it in module_sequence
        ]

    # Also expose activeItem for backwards compat (same as currentItem when running)
    participant_names = list(sess["participants"].values())
    participant_count = len(participant_names)
    response_count = 0
    if active_item and state == "running":
        bucket = _response_entries_for_module(sess["responses"].get(active_item["id"], {}), active_module)
        response_count = len(bucket)
    # Current index / total for progress
    current_index = sess.get("currentItemIndex")
    total = len(module_sequence)
    # Module display name
    display_name = next((m["displayName"] for m in MODULE_DEFS if m["id"] == active_module), active_module)
    content_data = _read_module_json(active_module) if active_module else None
    why_this = content_data.get("whyThisMatters") if content_data else None
    remember = content_data.get("rememberThis") if content_data else None
    return jsonify({
        "roomCode": code,
        "activeModule": active_module,
        "displayName": display_name,
        "state": state,  # lobby|running|complete or None
        "currentItem": current_item,
        "items": items,  # full self-paced sequence, sanitized + myAnswer-decorated, only while running
        "activeItem": safe_item if state == "running" else None,  # keep legacy, but only while running
        "currentIndex": current_index,
        "totalItems": total,
        "participantCount": participant_count,
        "participantNames": participant_names,
        "responseCount": response_count,
        "joinUrl": _get_join_url(code),
        "mySubmission": my_submission,
        "isSubmitted": my_is_submitted,
        "submittedAt": my_submitted_at,
        "whyThisMatters": why_this,
        "rememberThis": remember,
    })


@app.route("/api/admin/session/<code>/results", methods=["GET"])
@admin_required
def admin_results(code):
    code = code.strip().upper()
    sess = SESSIONS.get(code)
    if not sess:
        return jsonify({"error": "room not found"}), 404
    # Self-paced modules: admin can view results/correctness for ANY item in the sequence
    # (participants may be spread across different items), not only whichever one the admin's
    # own narration pointer is currently on — pass ?itemId=<id> to select one explicitly.
    requested_item_id = str(request.args.get("itemId") or "").strip()
    if requested_item_id:
        module_sequence = sess.get("moduleSequence") or []
        active_item = next((it for it in module_sequence if it.get("id") == requested_item_id), None)
    else:
        # No itemId given: fall back to the room's current activeItem, but only while actually
        # running — otherwise a module that left activeItem populated at completion (e.g.
        # crossword, see admin_next) would still be reported as "active" here between
        # completion and the next launch.
        active_item = sess.get("activeItem") if sess.get("state") == "running" else None
    if not active_item:
        return jsonify({
            "roomCode": code,
            "activeModule": sess.get("activeModule"),
            "activeItem": None,
            "counts": {},
            "totalResponses": 0,
            "participantCount": len(sess["participants"]),
            "participants": sess["participantMeta"],
            "responses": {},
            "respondedInOrder": [],
            "correctness": None,
        })
    item_id = active_item["id"]
    bucket = _response_entries_for_module(sess["responses"].get(item_id, {}), sess.get("activeModule"))

    def _entry_option(entry):
        # Backwards compat: older in-memory entries (pre-timestamp) stored a bare optionId
        # string instead of {"optionId":..., "respondedAt":...}.
        return entry.get("optionId") if isinstance(entry, dict) else entry

    def _entry_time(entry):
        return entry.get("respondedAt") if isinstance(entry, dict) else None

    # counts per option
    counts = {str(o["id"]): 0 for o in active_item.get("options", [])}
    for pid, entry in bucket.items():
        oid = _entry_option(entry)
        counts[str(oid)] = counts.get(str(oid), 0) + 1
    # per-participant list (name + choice) — unordered, kept for backwards compat
    per_participant = []
    for pid, entry in bucket.items():
        name = sess["participants"].get(pid, "unknown")
        per_participant.append({"participantId": pid, "name": name, "optionId": _entry_option(entry)})
    # Also include non-respondents
    non_respondents = []
    for pid, name in sess["participants"].items():
        if pid not in bucket:
            non_respondents.append({"participantId": pid, "name": name})
    # Admin-only "first come, first served" ordering — never exposed via participant /state,
    # not a persistent cross-activity score; it's scoped to this item's response bucket the
    # same way counts/responses already are, so it resets naturally on the next item/module.
    responded_in_order = [
        {
            "participantId": pid,
            "name": sess["participants"].get(pid, "unknown"),
            "optionId": _entry_option(entry),
            "respondedAt": _entry_time(entry),
        }
        for pid, entry in bucket.items()
    ]
    responded_in_order.sort(key=lambda r: r["respondedAt"] or "")
    # Per-item correctness count — admin-only (generalizes to any module whose normalized
    # item sets correctOptionId: myth-vs-fact, fault-finding, clue-quest, closing-quiz).
    # None when the item has no single correct answer (decision-room, pass-phrase, crossword).
    # Fault-finding's correctOptionId is per-participant (randomized fake-image slot — see
    # _effective_correct_option_id), so each responder's own effective value is checked rather
    # than a single shared one; correctOptionId below stays the item's base value, only for
    # display/back-compat.
    correctness = None
    correct_option_id = active_item.get("correctOptionId")
    if correct_option_id is not None:
        correct_count = sum(
            1 for r in responded_in_order
            if str(r["optionId"]) == str(_effective_correct_option_id(active_item, r["participantId"]))
        )
        correctness = {
            "correctOptionId": correct_option_id,
            "correctCount": correct_count,
            "incorrectCount": len(responded_in_order) - correct_count,
        }
    # Decision-room analog: "good decision" count per item (outcome=="good") — admin-only,
    # labeled distinctly as "good decisions" not "correct answers" so it isn't misread as same thing.
    goodness = None
    good_option_id = active_item.get("goodOptionId")
    if good_option_id is not None:
        good_count = sum(1 for r in responded_in_order if str(r["optionId"]) == str(good_option_id))
        goodness = {
            "goodOptionId": good_option_id,
            "goodCount": good_count,
            "otherCount": len(responded_in_order) - good_count,
        }
    responses_flat = {pid: _entry_option(entry) for pid, entry in bucket.items()}
    return jsonify({
        "roomCode": code,
        "activeModule": sess.get("activeModule"),
        "activeItem": active_item,  # full admin view includes fact/answer
        "counts": counts,
        "totalResponses": len(bucket),
        "participantCount": len(sess["participants"]),
        "participants": sess["participantMeta"],
        "responses": responses_flat,  # {participantId: optionId} — flat, kept for backwards compat
        "respondedInOrder": responded_in_order,  # admin-only, sorted first-to-respond first
        "correctness": correctness,
        "goodness": goodness,
        "perParticipant": per_participant,
        "nonRespondents": non_respondents,
    })


@app.route("/api/admin/session/<code>/progress", methods=["GET"])
@admin_required
def admin_progress(code):
    """Per-participant progress through the FULL self-paced sequence — answeredCount/
    totalCount, same shape as crossword's filledCount/totalCount progress panel, so the admin
    dashboard's Running view can show one consistent per-participant list regardless of module.

    Unlike crossword (a free-text grid the server can't otherwise observe, so participants ping
    their own progress via POST /crossword/progress), the 6 MC-style modules are computed here
    directly from sess["responses"] — the server already sees every discrete answer via
    /respond, so no separate client-side progress ping is needed for these.

    For modules with objective correctness (correctOptionId — myth-vs-fact, fault-finding,
    clue-quest, closing-quiz question items) also reports a LIVE per-participant correctCount.
    For decision-room (no single correct, but outcome=="good" tagged) reports goodCount
    analog metric labeled distinctly as "good decisions" not "correct". Both are admin-only
    and update live as the room answers — never sent to participants.
    """
    code = code.strip().upper()
    sess = SESSIONS.get(code)
    if not sess:
        return jsonify({"error": "room not found"}), 404
    module_sequence = sess.get("moduleSequence") or []
    total = len(module_sequence)
    items_by_id = {it.get("id"): it for it in module_sequence}
    has_correctness = any(it.get("correctOptionId") is not None for it in module_sequence)
    good_option_by_item = {
        it["id"]: it.get("goodOptionId") for it in module_sequence if it.get("goodOptionId") is not None
    }
    has_good = bool(good_option_by_item)
    item_ids = [it.get("id") for it in module_sequence]
    active_module = sess.get("activeModule")
    responses = sess.get("responses", {})
    result = []
    for pid, name in sess.get("participants", {}).items():
        answered = 0
        correct = 0
        good = 0
        last_at = None
        for item_id in item_ids:
            entry = _response_entries_for_module(responses.get(item_id, {}), active_module).get(pid)
            if entry is None:
                continue
            answered += 1
            at = entry.get("respondedAt") if isinstance(entry, dict) else None
            oid = entry.get("optionId") if isinstance(entry, dict) else entry
            # Fault-finding's correct slot is per-participant (randomized fake-image side) —
            # evaluate each participant's own effective correct option, not a single shared one.
            eff_correct = _effective_correct_option_id(items_by_id.get(item_id), pid)
            if eff_correct is not None and str(oid) == str(eff_correct):
                correct += 1
            if item_id in good_option_by_item and str(oid) == str(good_option_by_item[item_id]):
                good += 1
            if at and (last_at is None or at > last_at):
                last_at = at
        # Submission status — authoritative done signal
        _sub_raw = sess.get("submissions", {}).get(pid, {}).get(active_module)
        submitted_at = _sub_raw if isinstance(_sub_raw, str) else (_sub_raw.get("submittedAt") if isinstance(_sub_raw, dict) else _sub_raw)
        # normalize None -> no submission
        if submitted_at:
            submission_status = "submitted"
        elif total > 0 and answered >= total:
            submission_status = "reached_end"
        else:
            submission_status = "in_progress"
        entry_out = {
            "participantId": pid,
            "name": name,
            "filledCount": answered,
            "totalCount": total,
            "updatedAt": last_at,
            "submittedAt": submitted_at,
            "submissionStatus": submission_status,
        }
        if has_correctness:
            entry_out["correctCount"] = correct
        else:
            entry_out["correctCount"] = None
        if has_good:
            entry_out["goodCount"] = good
        result.append(entry_out)
    # Submitted first, then reached_end, then in_progress — within each group by progress
    def _status_rank(s):
        order = {"submitted": 0, "reached_end": 1, "in_progress": 2}
        return (order.get(s.get("submissionStatus"), 3), -s["filledCount"], s["name"].lower())
    result.sort(key=_status_rank)
    out = {
        "roomCode": code,
        "hasCorrectness": has_correctness,
        "hasGoodDecision": has_good,
        "activeModule": sess.get("activeModule"),
        "progress": result,
        "participantCount": len(sess.get("participants", {})),
        "totalCount": total,
    }
    # provide unified label hint for admin dashboard's consistent display
    if has_good:
        out["metricLabel"] = "good decisions"
    elif has_correctness:
        out["metricLabel"] = "correct"
    else:
        out["metricLabel"] = None
    return jsonify(out)


def _compute_module_summary(sess):
    """Admin-only "who finished fastest" data for the room's CURRENTLY loaded module sequence.

    Per participant: moduleStartedAt (their own first recorded response in this module),
    lastAnsweredAt (their most recent), completedAt (now the participant's deliberate
    submittedAt — the timestamp of their POST /submit for this module — rather than the
    last-item-answered-at. This makes Submit the authoritative 'done' signal, not just
    reaching the last item. Participants who have answered all items but not yet hit Submit
    are considered 'reached end, not submitted' and stay in inProgress, not ranked. Only
    submitted participants appear in ranked. For modules without objective correct answers
    the ranking is still by submittedAt. Never exposed to participants — only from admin routes.

    Crossword and pass-phrase also use submittedAt as the done signal, rather than
    filledCount/totalCount reaching full coverage — the grid/build is considered done when
    the participant taps Submit, not when the grid happens to be full.
    """
    active_module = sess.get("activeModule")
    submissions = sess.get("submissions", {})
    def _submitted_at(pid, mod):
        raw = submissions.get(pid, {}).get(mod) if mod else None
        if isinstance(raw, str):
            return raw
        if isinstance(raw, dict):
            return raw.get("submittedAt")
        return raw

    if active_module == "crossword":
        total = 0
        cw = sess.get("crosswordProgress", {})
        for entry in cw.values():
            total = max(total, int(entry.get("totalCount") or 0))
        summary = []
        for pid, name in sess.get("participants", {}).items():
            entry = cw.get(pid)
            filled = int(entry.get("filledCount") or 0) if entry else 0
            updated_at = entry.get("updatedAt") if entry else None
            submitted_at = _submitted_at(pid, active_module)
            is_complete = submitted_at is not None
            summary.append({
                "participantId": pid, "name": name,
                "answeredCount": filled, "totalCount": total,
                "isComplete": is_complete,
                "moduleStartedAt": None,
                "lastAnsweredAt": updated_at,
                "completedAt": submitted_at,
                "submittedAt": submitted_at,
                "correctCount": None,
            })
        return summary, False, total

    if active_module == "pass-phrase":
        module_sequence = sess.get("moduleSequence") or []
        round_ids = [it.get("id") for it in module_sequence]
        total_rounds = len(round_ids)
        builds = sess.get("passphraseBuilds", {})
        summary = []
        for pid, name in sess.get("participants", {}).items():
            rounds_built = builds.get(pid, {})
            entries = [(rid, rounds_built[rid].get("updatedAt")) for rid in round_ids if rid in rounds_built]
            answered_count = len(entries)
            timestamps = [t for _, t in entries if t]
            started_at = min(timestamps) if timestamps else None
            last_answered_at = max(timestamps) if timestamps else None
            submitted_at = _submitted_at(pid, active_module)
            is_complete = submitted_at is not None
            summary.append({
                "participantId": pid, "name": name,
                "answeredCount": answered_count, "totalCount": total_rounds,
                "isComplete": is_complete,
                "moduleStartedAt": started_at, "lastAnsweredAt": last_answered_at,
                "completedAt": submitted_at,
                "submittedAt": submitted_at,
                "correctCount": None,
            })
        return summary, False, total_rounds

    module_sequence = sess.get("moduleSequence") or []
    item_ids = [it.get("id") for it in module_sequence]
    items_by_id = {it.get("id"): it for it in module_sequence}
    total_items = len(item_ids)
    active_module = sess.get("activeModule")
    responses = sess.get("responses", {})
    has_correctness = any(it.get("correctOptionId") is not None for it in module_sequence)
    good_option_by_item = {
        it["id"]: it.get("goodOptionId") for it in module_sequence if it.get("goodOptionId") is not None
    }
    has_good = bool(good_option_by_item)

    summary = []
    for pid, name in sess.get("participants", {}).items():
        entries = []  # (item_id, respondedAt, optionId) for every item this participant answered
        for item_id in item_ids:
            entry = _response_entries_for_module(responses.get(item_id, {}), active_module).get(pid)
            if entry is None:
                continue
            at = entry.get("respondedAt") if isinstance(entry, dict) else None
            oid = entry.get("optionId") if isinstance(entry, dict) else entry
            entries.append((item_id, at, oid))
        answered_count = len(entries)
        timestamps = [e[1] for e in entries if e[1]]
        started_at = min(timestamps) if timestamps else None
        last_answered_at = max(timestamps) if timestamps else None
        # Authoritative done = explicit Submit, not just answered-everything
        submitted_at = _submitted_at(pid, active_module)
        is_complete = submitted_at is not None
        completed_at = submitted_at
        correct_count = None
        if has_correctness:
            # Fault-finding: each entry's effective correct option is this participant's own
            # randomized fake-image slot (see _effective_correct_option_id), not a shared value.
            correct_count = 0
            for item_id, _, oid in entries:
                eff_correct = _effective_correct_option_id(items_by_id.get(item_id), pid)
                if eff_correct is not None and str(oid) == str(eff_correct):
                    correct_count += 1
        good_count = None
        if has_good:
            good_count = sum(
                1 for item_id, _, oid in entries
                if item_id in good_option_by_item and str(oid) == str(good_option_by_item[item_id])
            )
        entry_out = {
            "participantId": pid, "name": name,
            "answeredCount": answered_count, "totalCount": total_items,
            "isComplete": is_complete,
            "moduleStartedAt": started_at, "lastAnsweredAt": last_answered_at,
            "completedAt": completed_at,
            "submittedAt": submitted_at,
            "correctCount": correct_count,
        }
        if has_good:
            entry_out["goodCount"] = good_count
        summary.append(entry_out)
    return summary, has_correctness, total_items


@app.route("/api/admin/session/<code>/module-summary", methods=["GET"])
@admin_required
def admin_module_summary(code):
    """Admin-only ranked "fastest overall" summary for the room's currently loaded module.

    Ranking: modules with objective correctness (correctOptionId — myth-vs-fact, fault-finding,
    clue-quest, closing-quiz) rank by correctCount descending, ties broken by completedAt
    ascending (fastest correct finisher wins ties). Decision-room ranks by goodCount (sound
    decisions) similarly, labeled distinctly. Modules without either rank by completedAt
    ascending only. Participants who haven't completed every item are excluded from the ranking
    but returned separately (inProgress) for context. Scoped to the room's CURRENTLY loaded
    moduleSequence — once a new module is launched the old one's sequence is gone (see
    admin_launch), so this only answers for whichever module is presently active, matching the
    Mark Complete flow it's built for.
    """
    code = code.strip().upper()
    sess = SESSIONS.get(code)
    if not sess:
        return jsonify({"error": "room not found"}), 404
    module = str(request.args.get("module") or sess.get("activeModule") or "").strip()
    if not module:
        return jsonify({"error": "no module specified and no active module"}), 400
    if module != sess.get("activeModule"):
        return jsonify({
            "error": "module-summary is only available for the room's currently loaded module sequence",
            "requestedModule": module,
            "activeModule": sess.get("activeModule"),
        }), 400
    summary, has_correctness, total_items = _compute_module_summary(sess)
    completed = [s for s in summary if s["isComplete"]]
    in_progress = [s for s in summary if not s["isComplete"]]
    # Detect decision-room style ranking (goodCount) — any entry with goodCount indicates
    # that module's analog metric should drive ranking instead of completedAt alone.
    has_good = any("goodCount" in s for s in summary)
    if has_correctness:
        completed.sort(key=lambda s: (-(s["correctCount"] or 0), s["completedAt"] or ""))
    elif has_good:
        completed.sort(key=lambda s: (-(s.get("goodCount") or 0), s["completedAt"] or ""))
    else:
        completed.sort(key=lambda s: s["completedAt"] or "")
    for i, s in enumerate(completed):
        s["rank"] = i + 1
    ranked_by = "correctCount" if has_correctness else ("goodCount" if has_good else "completedAt")
    out = {
        "roomCode": code,
        "module": module,
        "totalItems": total_items,
        "hasCorrectness": has_correctness,
        "hasGoodDecision": has_good,
        "rankedBy": ranked_by,
        "ranked": completed,
        "inProgress": in_progress,
    }
    if has_good:
        out["metricLabel"] = "good decisions"
    elif has_correctness:
        out["metricLabel"] = "correct"
    else:
        out["metricLabel"] = None
    return jsonify(out)


@app.route("/api/admin/dashboard", methods=["GET"])
@admin_required
def admin_dashboard():
    sessions = []
    for code, sess in SESSIONS.items():
        # participant count/names
        count = len(sess["participants"])
        active_item = sess.get("activeItem")
        response_count = 0
        if active_item:
            response_count = len(_response_entries_for_module(sess["responses"].get(active_item["id"], {}), sess.get("activeModule")))
        sessions.append({
            "roomCode": code,
            "createdAt": sess.get("createdAt"),
            "activeModule": sess.get("activeModule"),
            "hasActiveItem": active_item is not None,
            "activeItemId": active_item.get("id") if active_item else None,
            "participantCount": count,
            "participantNames": list(sess["participants"].values()),
            "responseCount": response_count,
            "joinUrl": _get_join_url(code),
        })
    # Sort by createdAt descending
    sessions.sort(key=lambda s: s.get("createdAt") or "", reverse=True)
    return jsonify({"sessions": sessions, "totalSessions": len(sessions)})


# --- Crossword lightweight sync (free-text grid, not single-option) ---
@app.route("/api/session/<code>/crossword/progress", methods=["POST"])
@limiter.limit("300/minute")
@persist_after
def crossword_progress(code):
    """Participants ping debounced progress: {participantId, filledCount, totalCount, correctCount?}.

    Per-word correctness (correctCount = entries where filled letters match the actual answer)
    is tracked as a distinct admin metric from raw filledCount, so the facilitator sees both
    "how much has been filled" and "how many entries are actually correct" — not conflated.
    correctCount is optional for backwards compat (older clients send only filledCount); when
    absent it stays None and admin sees filled-only until the client updates.
    """
    code = code.strip().upper()
    sess = SESSIONS.get(code)
    if not sess:
        return jsonify({"error": "room not found"}), 404
    data = request.get_json(silent=True) or {}
    if not data:
        data = request.form.to_dict(flat=True)
    participant_id = str(data.get("participantId") or data.get("participant_id") or data.get("pid") or "").strip()
    if not participant_id:
        return jsonify({"error": "participantId required"}), 400
    if participant_id not in sess.get("participants", {}):
        return jsonify({"error": "unknown participantId"}), 404
    # Lock after submit
    _sub = sess.get("submissions", {}).get(participant_id, {}).get(sess.get("activeModule"))
    if _sub:
        _sub_at = _sub if isinstance(_sub, str) else _sub.get("submittedAt")
        return jsonify({"error": "already submitted - progress locked", "submittedAt": _sub_at}), 403
    # Parse counts — accept int or str
    try:
        filled = int(data.get("filledCount", data.get("filled_count", 0)))
        total = int(data.get("totalCount", data.get("total_count", 0)))
    except Exception:
        return jsonify({"error": "filledCount and totalCount must be integers"}), 400
    # Optional per-word correctness — distinct from raw filled progress
    correct = None
    if "correctCount" in data or "correct_count" in data:
        try:
            correct = int(data.get("correctCount", data.get("correct_count", 0)))
        except Exception:
            return jsonify({"error": "correctCount must be integer"}), 400
        if correct < 0:
            correct = 0
        if total > 0 and correct > total:
            correct = total
    # Clamp
    if filled < 0:
        filled = 0
    if total < 0:
        total = 0
    if total > 0 and filled > total:
        filled = total
    # Ensure store exists for older sessions
    if "crosswordProgress" not in sess:
        sess["crosswordProgress"] = {}
    # Preserve previous correctCount if this ping didn't include it (debounced separate paths)
    prev = sess["crosswordProgress"].get(participant_id, {})
    if correct is None and "correctCount" in prev:
        correct = prev.get("correctCount")
    entry = {
        "filledCount": filled,
        "totalCount": total,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    if correct is not None:
        entry["correctCount"] = correct
    else:
        # keep None explicit so admin knows it's not yet reported
        entry["correctCount"] = None
    sess["crosswordProgress"][participant_id] = entry
    out = {"ok": True, "roomCode": code, "participantId": participant_id, "filledCount": filled, "totalCount": total}
    if correct is not None:
        out["correctCount"] = correct
    return jsonify(out)


@app.route("/api/admin/session/<code>/crossword/progress", methods=["GET"])
@admin_required
def admin_crossword_progress(code):
    """Admin poll: per-participant filled/total counts for live progress panel (~1.5s).

    Also returns per-word correctness (correctCount) when clients report it — distinct
    from raw filled progress, so admin sees "X/Y filled · Z correct (P%)" not conflated.
    """
    code = code.strip().upper()
    sess = SESSIONS.get(code)
    if not sess:
        return jsonify({"error": "room not found"}), 404
    # Ensure store exists
    if "crosswordProgress" not in sess:
        sess["crosswordProgress"] = {}
    prog = sess["crosswordProgress"]
    # Build per-participant list including those who haven't pinged yet (0/Y)
    # Determine a sensible default totalCount: most common total among pings, or 0
    default_total = 0
    if prog:
        # Use max totalCount seen as default (grid size)
        try:
            default_total = max(v.get("totalCount", 0) for v in prog.values())
        except Exception:
            default_total = 0
    active_module = sess.get("activeModule") or "crossword"
    result = []
    for pid, name in sess.get("participants", {}).items():
        entry = prog.get(pid)
        _sub_raw = sess.get("submissions", {}).get(pid, {}).get(active_module)
        submitted_at = _sub_raw if isinstance(_sub_raw, str) else (_sub_raw.get("submittedAt") if isinstance(_sub_raw, dict) else _sub_raw)
        if entry:
            cc = entry.get("correctCount")
            filled = int(entry.get("filledCount", 0))
            tot = int(entry.get("totalCount", 0))
            # submission status for crossword: submitted if has submittedAt, else reached_end if filled>=tot
            if submitted_at:
                sub_status = "submitted"
            elif tot > 0 and filled >= tot:
                sub_status = "reached_end"
            else:
                sub_status = "in_progress"
            result.append({
                "participantId": pid,
                "name": name,
                "filledCount": filled,
                "totalCount": tot,
                "correctCount": int(cc) if cc is not None else None,
                "updatedAt": entry.get("updatedAt"),
                "submittedAt": submitted_at,
                "submissionStatus": sub_status,
            })
        else:
            result.append({
                "participantId": pid,
                "name": name,
                "filledCount": 0,
                "totalCount": default_total,
                "correctCount": None,
                "updatedAt": None,
                "submittedAt": submitted_at,
                "submissionStatus": "submitted" if submitted_at else "in_progress",
            })
    # Submitted first, then reached_end, then in_progress — within each group by correctness/progress
    def _sort_key(x):
        order = {"submitted": 0, "reached_end": 1, "in_progress": 2}
        cc = x.get("correctCount")
        base = (order.get(x.get("submissionStatus"), 3),)
        if cc is not None:
            return base + (-cc, -x["filledCount"], x["name"].lower())
        return base + (-x["filledCount"], x["name"].lower())
    result.sort(key=_sort_key)
    return jsonify({
        "roomCode": code,
        "activeModule": sess.get("activeModule"),
        "progress": result,
        "participantCount": len(sess.get("participants", {})),
        "totalCount": default_total,
    })


@app.route("/api/session/<code>/passphrase/build", methods=["POST"])
@limiter.limit("300/minute")
@persist_after
def passphrase_build(code):
    """Participant's in-progress password build, sent on every change (debounced client-side —
    see els.actMount's pass-phrase handlers): {participantId, roundId, builtPassword}. Strength
    is always computed server-side (_pp_compute_strength) from the round's own weakPassword, the
    same criteria the console uses, so the client never has to duplicate or fake the scoring."""
    code = code.strip().upper()
    sess = SESSIONS.get(code)
    if not sess:
        return jsonify({"error": "room not found"}), 404
    data = request.get_json(silent=True) or {}
    participant_id = str(data.get("participantId") or data.get("participant_id") or "").strip()
    round_id = str(data.get("roundId") or data.get("round_id") or "").strip()
    built_password = str(data.get("builtPassword") or data.get("built_password") or "")
    if not participant_id or not round_id:
        return jsonify({"error": "participantId and roundId required"}), 400
    if participant_id not in sess.get("participants", {}):
        return jsonify({"error": "unknown participantId"}), 404
    # Lock after submit
    _sub = sess.get("submissions", {}).get(participant_id, {}).get(sess.get("activeModule"))
    if _sub:
        _sub_at = _sub if isinstance(_sub, str) else _sub.get("submittedAt")
        return jsonify({"error": "already submitted - build locked", "submittedAt": _sub_at}), 403
    module_sequence = sess.get("moduleSequence") or []
    round_item = next((it for it in module_sequence if it.get("id") == round_id), None)
    if not round_item or "deck" not in round_item:
        return jsonify({"error": "round not found in this activity's sequence"}), 400
    # Chunk-aware cap: total character count, not tile count (Part 2). Fall back to maxSlots
    # for older single-char content still in the wild.
    max_chars = int(round_item.get("maxChars") or round_item.get("maxSlots") or PP_MAX_CHARS)
    # also respect legacy maxSlots as character cap when deck was single-char (12)
    # new decks have maxChars=20, old have maxSlots=12
    built_password = built_password[:max_chars]
    # Chunk validation: deck is list of chunks (1-2 chars). Expand each chunk into its
    # constituent characters for validation — a "Ka" tile contributes one K and one a to the
    # available pool. This matches the chunk-aware cap (total chars) while still ensuring the
    # password was assembled only from deck-provided characters, respecting multiplicities.
    # For strictly chunk-boundary validation the client also sends the same builtPassword
    # string; the server's strength scoring remains on the full string exactly as before.
    deck_counts: dict = {}
    for chunk in round_item["deck"]:
        for ch in str(chunk):
            deck_counts[ch] = deck_counts.get(ch, 0) + 1
    used_counts: dict = {}
    for c in built_password:
        used_counts[c] = used_counts.get(c, 0) + 1
        if used_counts[c] > deck_counts.get(c, 0):
            return jsonify({"error": "builtPassword uses more of a character than the deck contains"}), 400
    strength = _pp_compute_strength(built_password, str(round_item.get("weakPassword") or ""))
    sess.setdefault("passphraseBuilds", {}).setdefault(participant_id, {})[round_id] = {
        "builtPassword": built_password,
        "strength": strength,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    return jsonify({"ok": True, "roomCode": code, "roundId": round_id, "builtPassword": built_password, "strength": strength})


@app.route("/api/admin/session/<code>/passphrase/progress", methods=["GET"])
@admin_required
def admin_passphrase_progress(code):
    """Admin poll: per-participant current strength level + how many of the module's rounds
    they've built something in, for the Running panel's progress list (same shape/pattern as
    crossword's progress panel)."""
    code = code.strip().upper()
    sess = SESSIONS.get(code)
    if not sess:
        return jsonify({"error": "room not found"}), 404
    module_sequence = sess.get("moduleSequence") or []
    total_rounds = len(module_sequence)
    builds = sess.get("passphraseBuilds", {})
    active_module = sess.get("activeModule") or "pass-phrase"
    result = []
    for pid, name in sess.get("participants", {}).items():
        rounds_built = builds.get(pid, {})
        completed_rounds = len(rounds_built)
        last_at = max((r.get("updatedAt") for r in rounds_built.values() if r.get("updatedAt")), default=None)
        current_strength = None
        if rounds_built:
            latest_round = max(rounds_built.items(), key=lambda kv: kv[1].get("updatedAt") or "")
            current_strength = latest_round[1].get("strength")
        _sub_raw = sess.get("submissions", {}).get(pid, {}).get(active_module)
        submitted_at = _sub_raw if isinstance(_sub_raw, str) else (_sub_raw.get("submittedAt") if isinstance(_sub_raw, dict) else _sub_raw)
        if submitted_at:
            sub_status = "submitted"
        elif total_rounds > 0 and completed_rounds >= total_rounds:
            sub_status = "reached_end"
        else:
            sub_status = "in_progress"
        result.append({
            "participantId": pid,
            "name": name,
            "filledCount": completed_rounds,
            "totalCount": total_rounds,
            "currentStrengthLabel": current_strength.get("label") if current_strength else None,
            "currentStrengthScore": current_strength.get("score") if current_strength else None,
            "updatedAt": last_at,
            "submittedAt": submitted_at,
            "submissionStatus": sub_status,
        })
    def _pp_sort(x):
        order = {"submitted": 0, "reached_end": 1, "in_progress": 2}
        return (order.get(x.get("submissionStatus"), 3), -x["filledCount"], x["name"].lower())
    result.sort(key=_pp_sort)
    return jsonify({
        "roomCode": code,
        "activeModule": sess.get("activeModule"),
        "progress": result,
        "participantCount": len(sess.get("participants", {})),
        "totalCount": total_rounds,
    })


@app.route("/api/admin/session/<code>/reset", methods=["POST"])
@admin_required
@persist_after
def admin_reset(code):
    """Clear participants/responses/activeModule so same room code can be reused for next group.

    Keeps the room code itself and creates a fresh timestamp; wipes everything
    that would leak between Synergy Cyber Security Awareness Month events without requiring a
    server restart. Participants must re-join after reset (old participantIds
    become unknown, join page handles this with a clear re-join prompt).
    """
    code = code.strip().upper()
    sess = SESSIONS.get(code)
    if not sess:
        return jsonify({"error": "room not found"}), 404
    now = datetime.now(timezone.utc).isoformat()
    # Preserve roomCode, reset everything that carries group state
    sess["participants"] = {}
    sess["participantMeta"] = {}
    sess["activeModule"] = None
    sess["state"] = None
    sess["moduleSequence"] = []
    sess["currentItemIndex"] = None
    sess["activeItem"] = None
    sess["responses"] = {}
    sess["crosswordProgress"] = {}
    sess["passphraseBuilds"] = {}
    sess["submissions"] = {}
    sess["createdAt"] = now
    # If you keep additional per-session stores, clear them here as well
    return jsonify({"ok": True, "roomCode": code, "message": "session reset — same code ready for next group", "createdAt": now})


# --- end additive ---

if __name__ == "__main__":
    check_deck_alignment()
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, host="0.0.0.0", port=port)

# Routes added (additive, original routes untouched):
#   GET    /health                                         -> {ok, sessionsLoaded} — public, no auth; point an external
#                                                             uptime pinger here if you need the dyno kept awake
#   POST   /api/admin/login                              -> {username?, password} sets session cookie
#   POST   /api/admin/logout                              -> clears session
#   GET    /api/admin/check                               -> {isAdmin}
#   GET    /admin | /admin/ | /admin/dashboard(.html)      -> serves admin/dashboard.html (public page; data gated)
#   POST   /api/session/create                            -> (admin) {roomCode, joinUrl}
#   GET    /api/session/<code>/qr                         -> PNG QR for join URL (request.host_url)
#   GET    /join/<code>                                    -> HTML join page (participant)
#   POST   /api/session/<code>/join   {name}               -> {participantId}
#   GET    /api/admin/modules                             -> 7 modules + live item counts from content/*.json
#   POST   /api/admin/session/<code>/launch {module}       -> loads module's item sequence, sets state=lobby
#   POST   /api/admin/session/<code>/start                -> lobby -> running: unlocks the FULL sequence for every
#                                                             phone at once (self-paced); also sets admin's own
#                                                             narration pointer to item 0 (requires >=1 participant)
#   POST   /api/admin/session/<code>/next {complete?}      -> advances admin's own narration/reveal pointer by one
#                                                             item; pass {"complete": true} to jump straight to
#                                                             complete instead of walking the whole sequence
#   POST   /api/admin/session/<code>/return-to-picker      -> complete -> idle (back to picker; room/participants/responses untouched)
#   POST   /api/admin/session/<code>/item                  -> 410 Gone (deprecated; use launch/start/next)
#   POST   /api/admin/session/<code>/reveal {itemId?, fact?} -> admin-screen-only reveal; itemId targets any item in
#                                                             the sequence (self-paced), omit to use activeItem
#   POST   /api/session/<code>/respond {participantId, itemId, optionId} -> itemId may be ANY item in the module's
#                                                             sequence, not only the admin's current one (self-paced)
#   GET    /api/session/<code>/state[?participantId=]      -> participant-safe state (lobby/running/complete/idle);
#                                                             while running, "items" carries the FULL sanitized
#                                                             sequence (self-paced full push), each item decorated
#                                                             with "myAnswer" when participantId is given
#   GET    /api/admin/session/<code>/results[?itemId=]     -> admin live counts + per-participant + respondedInOrder
#                                                             (first-to-respond order) + correctness for the given
#                                                             item (or the admin's current activeItem if omitted);
#                                                             never sent via participant /state
#   GET    /api/admin/session/<code>/progress              -> per-participant answeredCount/totalCount across the
#                                                             full sequence (same shape as crossword's progress
#                                                             panel), computed server-side from responses
#   GET    /api/admin/session/<code>/module-summary[?module=] -> admin-only ranked "fastest overall" for the
#                                                             room's currently loaded module (correctCount desc
#                                                             then completedAt for modules with correctOptionId;
#                                                             completedAt asc otherwise); never sent to participants
#   GET    /api/admin/dashboard                            -> all sessions + counts
#   POST   /api/session/<code>/crossword/progress {participantId, filledCount, totalCount} -> debounced ping (free-text grid)
#   GET    /api/admin/session/<code>/crossword/progress    -> per-participant X/Y for live progress panel (~1.5s)
#   POST   /api/admin/session/<code>/reset                 -> wipes participants/responses/state for reuse by a new group

