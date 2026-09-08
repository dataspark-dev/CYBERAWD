#!/usr/bin/env python3
"""One-off content generator for live-event/content/pass-phrase.json's weakPassword/deck fields.

Run from the repo root: python scripts/gen_passphrase_content.py

Calls the same Python ports of the console's own generateWeakPassword()/generateDeck()
(pass-phrase.js) that app.py falls back to at runtime if a round is missing these fields
(_pp_generate_weak_password/_pp_generate_deck) — see docs/APPLICATION_STATE.md §5 for why the
phone's deck is generated once into static content instead of regenerated per-launch like the
console's is. Re-run this only if you deliberately want fresh rounds; it overwrites the existing
weakPassword/deck for every round using each round's own "difficulty" field.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import app as appmod  # noqa: E402

CONTENT_PATH = ROOT / "live-event" / "content" / "pass-phrase.json"


def main():
    with open(CONTENT_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    for r in data["rounds"]:
        difficulty = r["difficulty"]
        weak = appmod._pp_generate_weak_password(difficulty)
        deck = appmod._pp_generate_deck(difficulty, weak)
        r["weakPassword"] = weak
        r["deck"] = deck
        print(r["id"], difficulty, "->", weak, "| deck:", "".join(deck))

    with open(CONTENT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"\nWrote weakPassword + deck ({appmod.PP_DECK_SIZE} chunks, mixed 1-3 chars) into {CONTENT_PATH}")


if __name__ == "__main__":
    main()
