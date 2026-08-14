#!/usr/bin/env python3
"""
Deck manifest extractor — Synergy Cyber Security Awareness Month deck.

Read-only. Parses deck.js, main.css, main.js, index.html and every
slides/*.html file and writes:
  - deck-manifest.json  (full structured snapshot)
  - deck-manifest.md    (human-readable summary)

Does not modify any source file. Safe to re-run any time; auto-adapts
to however many slides currently exist (reads deck.js's SLIDES array
as the source of truth for order/grouping, and slides/*.html on disk
as the source of truth for what actually exists).

Dependency: beautifulsoup4 (pip install beautifulsoup4).
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path

try:
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit(
        "This script requires BeautifulSoup.\n"
        "Install it with:  pip install beautifulsoup4"
    )

ROOT = Path(__file__).resolve().parent
SLIDES_DIR = ROOT / "slides"
DECK_JS = ROOT / "scripts" / "deck.js"
MAIN_JS = ROOT / "scripts" / "main.js"
MAIN_CSS = ROOT / "styles" / "main.css"
INDEX_HTML = ROOT / "index.html"

OUT_JSON = ROOT / "deck-manifest.json"
OUT_MD = ROOT / "deck-manifest.md"

# Known interactive component patterns to detect, per the deck's component library.
KNOWN_COMPONENTS = [
    "toggle-switch",
    "hotspot",
    "compare-slider",
    "flow-scene",
    "lock-demo",
    "flip-card",
    "scenario-card",
    "spot-grid",
    "checklist-grid",
    "count-up",
    "reveal-click-zone",  # click-through progressive reveal (revealNextPoint), e.g. slide-13's chain
]

SLIDE_ARRAY_RE = re.compile(
    r"\{\s*file:\s*(?P<qf>['\"])(?P<file>.*?)(?P=qf)\s*,\s*"
    r"title:\s*(?P<qt>['\"])(?P<title>.*?)(?P=qt)\s*,\s*"
    r"group:\s*(?P<qg>['\"])(?P<group>.*?)(?P=qg)\s*\}"
)

HEX_RE = re.compile(r"#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b")
VAR_RE = re.compile(r"var\(\s*(--[a-zA-Z0-9-]+)\s*\)")
SLIDE_OF_RE = re.compile(r"SLIDE\s+(\d+)\s+OF\s+(\d+)", re.IGNORECASE)
ROOT_VAR_LINE_RE = re.compile(r"(--[a-zA-Z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,6})")
DECL_RE = re.compile(r"([\w-]+)\s*:\s*([^;{}]+)")


def is_color_property(prop):
    """CSS custom properties are also used for non-color purposes (e.g. a
    per-element --w percentage driving a width animation). Only flag var()
    references as 'undefined theme color' when the declaration they're in
    is actually a color-bearing property — otherwise --w/--dur/etc false-positive."""
    prop = prop.lower()
    if prop.endswith("color"):
        return True
    if prop.startswith("background"):
        return True
    return prop in ("border", "box-shadow", "outline", "fill", "stroke", "text-shadow")

STOPWORDS = {
    "the", "a", "an", "of", "in", "on", "to", "is", "are", "for", "and",
    "your", "you", "with", "when", "how", "what", "why", "it", "this",
    "that", "too", "vs", "&",
}


# ---------------------------------------------------------------- deck.js ----

def parse_deck_js(text):
    m = re.search(r"var\s+SLIDES\s*=\s*\[(.*?)\]\s*;", text, re.DOTALL)
    if not m:
        raise SystemExit("Could not locate the SLIDES array in deck.js")
    entries = [
        {"file": mm.group("file"), "title": mm.group("title"), "group": mm.group("group")}
        for mm in SLIDE_ARRAY_RE.finditer(m.group(1))
    ]
    if not entries:
        raise SystemExit("SLIDES array found but no entries parsed — check deck.js formatting")
    return entries


# ---------------------------------------------------------------- main.css ----

def parse_root_vars(css_text):
    m = re.search(r":root\s*\{(.*?)\}", css_text, re.DOTALL)
    varmap = {}
    if m:
        for name, value in ROOT_VAR_LINE_RE.findall(m.group(1)):
            varmap[name] = value.lower()
    return varmap


# ------------------------------------------------------------- helpers -------

def significant_words(s):
    s = re.sub(r"[^a-zA-Z0-9\s]", " ", s.lower())
    return {w for w in s.split() if len(w) > 2 and w not in STOPWORDS}


def get_text(el):
    return el.get_text(" ", strip=True) if el else None


# --------------------------------------------------------- per-slide parse ---

def extract_slide(path, deck_entry, index, total_slides, group_sizes, group_positions,
                   root_vars, hex_to_var):
    raw = path.read_text(encoding="utf-8")
    soup = BeautifulSoup(raw, "html.parser")
    flags = []

    slide_tag = get_text(soup.find(class_="slide-tag"))
    eyebrow = get_text(soup.find(class_="slide-eyebrow"))
    h1_text = get_text(soup.find("h1"))
    section_leads = [get_text(p) for p in soup.find_all(class_="section-lead")]

    cards = []
    for heading in soup.find_all(["h3", "h4"]):
        p = heading.find_next_sibling("p")
        cards.append({
            "tag": heading.name,
            "heading": get_text(heading),
            "body": get_text(p),
        })

    # ---- check 1: "SLIDE X OF N" tag correctness (global or group-local) ----
    if slide_tag:
        for x_str, n_str in SLIDE_OF_RE.findall(slide_tag):
            x, n = int(x_str), int(n_str)
            group = deck_entry["group"]
            if n == total_slides:
                if x != index:
                    flags.append({
                        "severity": "error", "check": "slide-of-n",
                        "message": (f"slide-tag reads 'SLIDE {x} OF {n}' (global) but this "
                                    f"is slide {index} of {total_slides}.")
                    })
            elif n == group_sizes.get(group):
                if x != group_positions.get(path.name):
                    flags.append({
                        "severity": "error", "check": "slide-of-n",
                        "message": (f"slide-tag reads 'SLIDE {x} OF {n}' (group-local) but this "
                                    f"is position {group_positions.get(path.name)} of "
                                    f"{group_sizes.get(group)} within group '{group}'.")
                    })
            else:
                flags.append({
                    "severity": "warning", "check": "slide-of-n",
                    "message": (f"slide-tag reads 'SLIDE {x} OF {n}' but {n} matches neither "
                                f"the total slide count ({total_slides}) nor this slide's "
                                f"group size ({group_sizes.get(group)}).")
                })

    # ---- check 2: deck.js title vs actual <h1> — heuristic drift flag ----
    if h1_text and deck_entry["title"]:
        overlap = significant_words(deck_entry["title"]) & significant_words(h1_text)
        if not overlap:
            flags.append({
                "severity": "info", "check": "title-drift",
                "message": (f"deck.js title '{deck_entry['title']}' shares no significant "
                            f"words with this slide's <h1> '{h1_text}'. Could be an "
                            f"intentional group-label-style title, or real drift — verify manually.")
            })

    # ---- component inventory ----
    components = sorted(name for name in KNOWN_COMPONENTS if soup.find(class_=name))

    # ---- theme: dark vs light, colors used ----
    slide_root = soup.find(class_="slide")
    theme = "unknown"
    if slide_root:
        theme = "dark" if "slide-dark" in (slide_root.get("class") or []) else "light"

    style_tag = soup.find("style")
    style_text = style_tag.get_text() if style_tag else ""
    inline_style_text = " ".join(t.get("style", "") for t in soup.find_all(style=True))
    color_text = style_text + " " + inline_style_text

    hexes_found = sorted({h.lower() for h in HEX_RE.findall(color_text)})
    vars_found = sorted(set(VAR_RE.findall(color_text)))

    color_context_vars = set()
    for prop, value in DECL_RE.findall(color_text):
        if is_color_property(prop):
            color_context_vars.update(VAR_RE.findall(value))

    off_palette = [h for h in hexes_found if h not in hex_to_var]
    undefined_vars = [v for v in color_context_vars if v not in root_vars]
    if undefined_vars:
        flags.append({
            "severity": "error", "check": "undefined-css-var",
            "message": f"References CSS variable(s) not defined in main.css :root: {', '.join(undefined_vars)}"
        })

    # ---- assets referenced ----
    assets = []
    for tag in soup.find_all(["img", "script", "link"]):
        for attr in ("src", "href"):
            if tag.has_attr(attr):
                assets.append(tag[attr])

    local_assets = [a for a in assets if not a.startswith(("http://", "https://"))]
    bad_prefix = [a for a in local_assets if not a.startswith("../")]
    broken_links = []
    for a in local_assets:
        resolved = (path.parent / a).resolve()
        if not resolved.exists():
            broken_links.append(a)
    if bad_prefix:
        flags.append({
            "severity": "warning", "check": "asset-prefix",
            "message": f"Local asset path(s) not using the '../' convention used elsewhere: {bad_prefix}"
        })
    if broken_links:
        flags.append({
            "severity": "error", "check": "broken-asset-link",
            "message": f"Referenced asset path(s) do not resolve to a file on disk: {broken_links}"
        })

    return {
        "index": index,
        "file": path.name,
        "deck_title": deck_entry["title"],
        "group": deck_entry["group"],
        "slide_tag": slide_tag,
        "eyebrow": eyebrow,
        "h1": h1_text,
        "section_lead": section_leads,
        "cards": cards,
        "components": components,
        "theme": theme,
        "hex_colors": hexes_found,
        "off_palette_colors": off_palette,
        "var_colors": vars_found,
        "assets": assets,
        "flags": flags,
    }


# --------------------------------------------------------------- flow map ----

def build_flow_map(deck_entries):
    flow = []
    seen_groups = []
    by_group = {}
    for i, e in enumerate(deck_entries, start=1):
        g = e["group"]
        if g not in by_group:
            by_group[g] = []
            seen_groups.append(g)
        by_group[g].append({"index": i, "file": e["file"], "title": e["title"]})
    for g in seen_groups:
        items = by_group[g]
        flow.append({
            "group": g,
            "slide_indexes": [it["index"] for it in items],
            "files": [it["file"] for it in items],
            "titles": [it["title"] for it in items],
        })
    return flow


# ---------------------------------------------------------------- main -------

def main():
    for required in (DECK_JS, MAIN_CSS, INDEX_HTML, SLIDES_DIR):
        if not required.exists():
            raise SystemExit(f"Expected path not found: {required}")

    deck_entries = parse_deck_js(DECK_JS.read_text(encoding="utf-8"))
    total_slides = len(deck_entries)

    group_sizes = {}
    group_positions = {}
    running = {}
    for e in deck_entries:
        group_sizes[e["group"]] = group_sizes.get(e["group"], 0) + 1
    for e in deck_entries:
        running[e["group"]] = running.get(e["group"], 0) + 1
        group_positions[e["file"]] = running[e["group"]]

    root_vars = parse_root_vars(MAIN_CSS.read_text(encoding="utf-8"))
    hex_to_var = {}
    for name, value in root_vars.items():
        hex_to_var.setdefault(value, name)

    files_on_disk = sorted(p.name for p in SLIDES_DIR.glob("slide-*.html"))
    files_in_deckjs = [e["file"] for e in deck_entries]

    missing_files = [f for f in files_in_deckjs if f not in files_on_disk]
    orphan_files = [f for f in files_on_disk if f not in files_in_deckjs]

    slides_out = []
    for idx, entry in enumerate(deck_entries, start=1):
        path = SLIDES_DIR / entry["file"]
        if not path.exists():
            continue  # already captured in missing_files
        slides_out.append(
            extract_slide(path, entry, idx, total_slides, group_sizes, group_positions,
                          root_vars, hex_to_var)
        )

    flow_map = build_flow_map(deck_entries)

    static_slides = [s["file"] for s in slides_out if not s["components"]]
    theme_counts = {"dark": [], "light": [], "unknown": []}
    for s in slides_out:
        theme_counts.setdefault(s["theme"], []).append(s["file"])

    all_off_palette = {}
    for s in slides_out:
        for h in s["off_palette_colors"]:
            all_off_palette.setdefault(h, []).append(s["file"])

    all_flags = []
    for s in slides_out:
        for f in s["flags"]:
            all_flags.append({"file": s["file"], **f})
    if missing_files:
        all_flags.append({
            "file": None, "severity": "error", "check": "missing-file",
            "message": f"deck.js references file(s) not found on disk: {missing_files}"
        })
    if orphan_files:
        all_flags.append({
            "file": None, "severity": "warning", "check": "orphan-file",
            "message": f"slides/ contains file(s) not referenced in deck.js SLIDES array: {orphan_files}"
        })

    manifest = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "root": str(ROOT),
        "total_slides_in_deckjs": total_slides,
        "slide_files_on_disk": files_on_disk,
        "missing_files": missing_files,
        "orphan_files": orphan_files,
        "flow_map": flow_map,
        "static_slides_no_components": static_slides,
        "theme_root_vars": root_vars,
        "theme_usage": {k: v for k, v in theme_counts.items() if v},
        "off_palette_colors": all_off_palette,
        "slides": slides_out,
        "all_flags": all_flags,
    }

    OUT_JSON.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    OUT_MD.write_text(render_markdown(manifest), encoding="utf-8")

    print(f"Wrote {OUT_JSON.name} and {OUT_MD.name}")
    print(f"Slides parsed: {len(slides_out)} / {total_slides} in deck.js")
    err = sum(1 for f in all_flags if f["severity"] == "error")
    warn = sum(1 for f in all_flags if f["severity"] == "warning")
    info = sum(1 for f in all_flags if f["severity"] == "info")
    print(f"Flags - error: {err}, warning: {warn}, info: {info}")


# ------------------------------------------------------------- markdown ------

def render_markdown(m):
    lines = []
    lines.append("# Deck Manifest")
    lines.append("")
    lines.append(f"Generated: {m['generated_at']}  ")
    lines.append(f"Total slides (deck.js): {m['total_slides_in_deckjs']}  ")
    lines.append(f"Slide files on disk: {len(m['slide_files_on_disk'])}")
    lines.append("")

    if m["missing_files"] or m["orphan_files"]:
        lines.append("> **File/deck.js mismatch detected** — see Issues section below.")
        lines.append("")

    lines.append("## Slide-by-Slide")
    lines.append("")
    lines.append("| # | Title (deck.js) | Group | Components | Flags |")
    lines.append("|---|---|---|---|---|")
    for s in m["slides"]:
        comps = ", ".join(s["components"]) if s["components"] else "_static_"
        flag_count = len(s["flags"])
        flag_summary = f"{flag_count} ⚠" if flag_count else "—"
        title = s["deck_title"].replace("|", "\\|")
        lines.append(f"| {s['index']} | {title} | {s['group']} | {comps} | {flag_summary} |")
    lines.append("")

    lines.append("## Flow Map")
    lines.append("")
    for g in m["flow_map"]:
        idx_range = f"{g['slide_indexes'][0]}–{g['slide_indexes'][-1]}" if len(g["slide_indexes"]) > 1 else str(g["slide_indexes"][0])
        lines.append(f"- **{g['group']}** (slides {idx_range}): " + " → ".join(g["titles"]))
    lines.append("")

    lines.append("## Interactive Component Inventory")
    lines.append("")
    comp_to_slides = {}
    for s in m["slides"]:
        for c in s["components"]:
            comp_to_slides.setdefault(c, []).append(s["index"])
    for c in KNOWN_COMPONENTS:
        idxs = comp_to_slides.get(c, [])
        lines.append(f"- `{c}`: {len(idxs)} slide(s) — {idxs if idxs else 'none'}")
    lines.append("")
    static = m["static_slides_no_components"]
    lines.append(f"**Static / reading-only slides (no known interactive component):** {static if static else 'none'}")
    lines.append("")

    lines.append("## Theme Audit")
    lines.append("")
    lines.append("Root palette (main.css `:root`):")
    for name, value in m["theme_root_vars"].items():
        lines.append(f"- `{name}`: `{value}`")
    lines.append("")
    lines.append("Theme usage per slide:")
    for theme, files in m["theme_usage"].items():
        lines.append(f"- **{theme}**: {files}")
    lines.append("")
    if m["off_palette_colors"]:
        lines.append("Hex colors used that are **not** a defined `:root` variable value:")
        for h, files in sorted(m["off_palette_colors"].items()):
            lines.append(f"- `{h}` — used in: {files}")
    else:
        lines.append("No off-palette hex colors found — every hex color used matches a `:root` variable value.")
    lines.append("")

    lines.append("## Issues Flagged")
    lines.append("")
    if not m["all_flags"]:
        lines.append("No issues flagged.")
    else:
        for f in m["all_flags"]:
            where = f["file"] if f["file"] else "(deck-wide)"
            icon = {"error": "🔴", "warning": "🟡", "info": "🔵"}.get(f["severity"], "•")
            lines.append(f"- {icon} **{f['severity'].upper()}** [{f['check']}] `{where}`: {f['message']}")
    lines.append("")

    return "\n".join(lines)


if __name__ == "__main__":
    main()
