#!/usr/bin/env python3
"""
Synergy Cyber Security Awareness Month — presentation server.

Serves the static viewer (index.html, scripts, styles, assets, slides)
over Flask. Validates that every slide listed in deck.js actually exists
on disk at startup.
"""

import os
import re
import sys
from pathlib import Path

from flask import Flask, send_from_directory, abort

ROOT = Path(__file__).resolve().parent
DECK_JS = ROOT / "scripts" / "deck.js"
SLIDES_DIR = ROOT / "slides"
SCRIPTS_DIR = ROOT / "scripts"
STYLES_DIR = ROOT / "styles"
ASSETS_DIR = ROOT / "assets"
LIVE_EVENT_DIR = ROOT / "live-event"
INDEX_HTML = ROOT / "index.html"

SLIDE_ENTRY_RE = re.compile(r"\{\s*file:\s*['\"](?P<file>[^'\"]+)['\"]")

app = Flask(__name__)


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
    return send_from_directory(LIVE_EVENT_DIR, "index.html")


@app.route("/live-event/<path:filename>")
def live_event(filename):
    return send_from_directory(LIVE_EVENT_DIR, filename)


if __name__ == "__main__":
    check_deck_alignment()
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, host="0.0.0.0", port=port)