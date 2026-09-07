"""One-off generator for live-event/content/crossword.json's grid.

No crossword-grid generator previously existed in this repo (the original 20x20/18-word grid
appears to have been hand-authored or generated ad hoc). This is a standard constructive
crossword-fill algorithm: place the longest word first, then place each remaining word at a
random valid intersection with an already-placed word (checking letter matches, cell-adjacency
rules so words don't accidentally touch/extend, and grid bounds), trying many random
orderings/seeds and keeping the smallest resulting bounding box — i.e. the most compact grid
that still places every word via a real intersection (no disconnected fallback placements).

Run again any time the wordlist changes: `python scripts/gen_crossword_grid.py`.
"""
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT_PATH = ROOT / "live-event" / "content" / "crossword.json"

# Reduced wordlist (11 terms, down from 18) — kept: terms this app's other modules actually
# reinforce elsewhere (PHISHING/SPOOFING/PRETEXTING across fault-finding, clue-quest,
# live-simulation, myth-vs-fact's social-engineering items; MFA as live-simulation's MFA
# defense point; RANSOMWARE/BREACH as named decision-room cases; PASSWORD as the
# whole pass-phrase module's subject). Cut: VPN, ANTIVIRUS, PRIVACY, TROJAN, PATCH, BOTNET, SPAM
# — general vocabulary with no scenario elsewhere in this specific app to reinforce it.
WORDS = [
    ("PHISHING", "A fake message designed to trick you into clicking or sharing information"),
    ("MALWARE", "General term for any software built to damage, spy on, or take over a device"),
    ("RANSOMWARE", "Malware that locks your files and demands payment before you can get them back"),
    ("MFA", "You enter your password, then approve a prompt on your phone — that second step is called this"),
    ("PASSWORD", "The secret combination of characters that proves it's really you logging in"),
    ("SPOOFING", "Faking a sender address or caller ID so a message looks like it's from someone you trust"),
    ("BREACH", "What happens when sensitive data is exposed or stolen from a system — a data ___"),
    ("BACKUP", "A saved copy of your files that lets you recover after ransomware or a crash"),
    ("FIREWALL", "The security layer that filters traffic in and out of a network, blocking what looks dangerous"),
    ("PRETEXTING", "A social engineering trick where the attacker invents a false scenario, like posing as IT support"),
    ("ENCRYPTION", "Scrambling data so that only someone with the right key can read it"),
]

WORK_SIZE = 30
CENTER = WORK_SIZE // 2


def can_place(grid, word, row, col, direction):
    for i, ch in enumerate(word):
        r = row + i if direction == "down" else row
        c = col + i if direction == "across" else col
        if r < 0 or r >= WORK_SIZE or c < 0 or c >= WORK_SIZE:
            return False
        existing = grid.get((r, c))
        if existing is not None and existing != ch:
            return False
    before = (row, col - 1) if direction == "across" else (row - 1, col)
    after = (row, col + len(word)) if direction == "across" else (row + len(word), col)
    if before in grid or after in grid:
        return False
    for i, ch in enumerate(word):
        r = row + i if direction == "down" else row
        c = col + i if direction == "across" else col
        if grid.get((r, c)) == ch:
            continue  # real intersection cell — already letter-checked above
        # non-intersection cell: perpendicular neighbors must be empty, or this word would run
        # flush against an unrelated word with no gap (reads as an accidental extra word)
        if direction == "across":
            if (r - 1, c) in grid or (r + 1, c) in grid:
                return False
        else:
            if (r, c - 1) in grid or (r, c + 1) in grid:
                return False
    return True


def place_word(grid, word, row, col, direction):
    for i, ch in enumerate(word):
        r = row + i if direction == "down" else row
        c = col + i if direction == "across" else col
        grid[(r, c)] = ch


def find_intersections(grid, word, rng):
    candidates = []
    for (r, c), ch in grid.items():
        for i, wch in enumerate(word):
            if wch != ch:
                continue
            candidates.append((r, c - i, "across"))
            candidates.append((r - i, c, "down"))
    rng.shuffle(candidates)
    return candidates


def try_build(words, seed):
    rng = random.Random(seed)
    order = list(words)
    rng.shuffle(order)
    order.sort(key=lambda w: -len(w[0]))  # longest-first bias, shuffled among ties
    grid = {}
    placements = []
    first_word, first_clue = order[0]
    start_col = CENTER - len(first_word) // 2
    place_word(grid, first_word, CENTER, start_col, "across")
    placements.append({"answer": first_word, "clue": first_clue, "row": CENTER, "col": start_col, "direction": "across"})
    for word, clue in order[1:]:
        placed = False
        for row, col, direction in find_intersections(grid, word, rng):
            if can_place(grid, word, row, col, direction):
                place_word(grid, word, row, col, direction)
                placements.append({"answer": word, "clue": clue, "row": row, "col": col, "direction": direction})
                placed = True
                break
        if not placed:
            return None  # this ordering/seed failed to place every word via intersection — discard
    rows = [p["row"] if p["direction"] == "across" else p["row"] for p in placements]
    return grid, placements


def bounding_box(grid):
    rs = [r for r, c in grid]
    cs = [c for r, c in grid]
    return min(rs), max(rs), min(cs), max(cs)


def assign_numbers(grid, placements):
    min_r, max_r, min_c, max_c = bounding_box(grid)
    starts = {}  # (r,c) -> number
    number = 1
    for r in range(min_r, max_r + 1):
        for c in range(min_c, max_c + 1):
            if (r, c) not in grid:
                continue
            starts_across = (r, c - 1) not in grid and (r, c + 1) in grid
            starts_down = (r - 1, c) not in grid and (r + 1, c) in grid
            if starts_across or starts_down:
                starts[(r, c)] = number
                number += 1
    for p in placements:
        p["number"] = starts[(p["row"], p["col"])]
        p["row"] -= min_r
        p["col"] -= min_c
    return max_r - min_r + 1, max_c - min_c + 1


def main():
    best = None
    best_key = None
    for seed in range(250000):
        result = try_build(WORDS, seed)
        if result is None:
            continue
        grid, placements = result
        min_r, max_r, min_c, max_c = bounding_box(grid)
        h, w = max_r - min_r + 1, max_c - min_c + 1
        area = h * w
        # Column count is the binding constraint for fitting a 375px phone width without the
        # horizontal-scroll fallback (cwRenderGrid: CELL_MIN=32px, 1px gaps, ~359px available at
        # 375px viewport -> max ~10 columns before cells get clamped to 32px and overflow into
        # scroll). Minimize columns first, then rows (avoid an unnecessarily tall grid), then area.
        key = (w, h, area)
        if best_key is None or key < best_key:
            best_key = key
            best = (area, grid, placements)
    if best is None:
        raise SystemExit("No seed produced a fully-connected placement for all words — widen search or check wordlist overlap")
    area, grid, placements = best
    rows, cols = assign_numbers(grid, placements)
    placements.sort(key=lambda p: p["number"])
    print(f"Best grid: {rows}x{cols} ({rows*cols} cells, {len(grid)} filled) from {len(WORDS)} words")
    for p in placements:
        print(f"  {p['number']:2d} {p['direction']:6s} ({p['row']:2d},{p['col']:2d}) {p['answer']}")

    content = json.loads(CONTENT_PATH.read_text(encoding="utf-8"))
    content["wordlist"] = [{"answer": w, "clue": c} for w, c in WORDS]
    content["grid"] = {"rows": rows, "cols": cols, "placements": placements}
    CONTENT_PATH.write_text(json.dumps(content, indent=2) + "\n", encoding="utf-8")
    print(f"\nWrote {CONTENT_PATH}")


if __name__ == "__main__":
    main()
