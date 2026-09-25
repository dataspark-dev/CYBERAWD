"""
Export the IT Support and Development audience-specific deck sequences to
their own .pptx files.

Resolves each audience's actual final slide sequence the same way
scripts/deck.js's buildDeck() does client-side (skip -> early topic insert
-> topic insert -> desk/login/ai-paste/shadow-ai swap -> closing swap),
but server-side in Python, reusing app.py's own load_audience_*_file_map()
functions as the single source of truth - the exact same functions
check_deck_alignment() uses to validate scripts/deck.js at startup. This
script never re-parses deck.js itself, so it can't silently drift from
what the app already validates.

Renders each resolved slides/*.html file with a headless browser at
1920x1080 and drops the screenshot into a 16:9 PowerPoint deck, one slide
per screenshot - identical capture approach to export_slides.py, just
driven by a resolved per-audience file list instead of the base SLIDES
array.

Usage:
    python app.py                              # in one terminal
    python export_audience_slides.py           # both audiences
    python export_audience_slides.py it-support        # one audience only
    python export_audience_slides.py development

Requires: playwright (with `playwright install chromium` run once),
python-pptx. Both already available in this project's environment.
"""

import asyncio
import os
import shutil
import sys
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from playwright.async_api import async_playwright
from pptx import Presentation
from pptx.util import Inches

import app as app_module
from export_slides import (
    INIT_SCRIPT,
    PPTX_HEIGHT_IN,
    PPTX_WIDTH_IN,
    SCALE,
    SERVER_BASE,
    VIEWPORT_HEIGHT,
    VIEWPORT_WIDTH,
)

ROOT = Path(__file__).resolve().parent

# Audience id -> output filename. Matches the display names used elsewhere
# (admin dashboard's audience picker, app.py's AUDIENCE_DEFS). IT Support and Development were
# merged into 'technology-team' - see AUDIENCE_FULL_DECK_OVERRIDE in scripts/deck.js.
AUDIENCE_OUTPUT_NAMES = {
    "technology-team": "Synergy_Cyber_Security_Awareness_Month_Technology_Team.pptx",
}


def resolve_audience_slides(audience):
    """Reproduce scripts/deck.js's buildDeck() slide resolution in Python.

    Checks AUDIENCE_FULL_DECK_OVERRIDE first - if present for this audience, that fully replaces
    the sequence (mirrors applyAudienceFullDeckOverride() running first in deck.js), skipping
    every other map entirely, the same way the live deck does. Otherwise, order mirrors the
    DOMContentLoaded call sequence in scripts/deck.js exactly: skip -> early topic insert
    (anchored after slide-02.html) -> topic insert (anchored after slide-13.html) ->
    Desk/Login/AI-paste/Shadow-AI swaps (each matched by the known original base filename, since
    none of those four are ever touched by skip or either insert) -> Closing swap. Every map is
    loaded straight from app.py, so this can never drift from what check_deck_alignment() already
    validates against scripts/deck.js at startup.
    """
    override = app_module.load_audience_full_override_file_map().get(audience, [])
    if override:
        missing = [f for f in override if not (ROOT / "slides" / f).exists()]
        if missing:
            print(f"ERROR: full-override sequence for '{audience}' references file(s) missing from slides/: {missing}", file=sys.stderr)
            sys.exit(1)
        return list(override)

    slides = app_module.load_deck_file_list()
    if not slides:
        print("ERROR: could not read SLIDES array from scripts/deck.js", file=sys.stderr)
        sys.exit(1)
    slides = list(slides)

    skip = set(app_module.load_audience_skip_file_map().get(audience, []))
    slides = [f for f in slides if f not in skip]

    early = app_module.load_audience_early_topic_file_map().get(audience, [])
    if early:
        idx = slides.index("slide-02.html")
        slides[idx + 1:idx + 1] = early

    topics = app_module.load_audience_topic_file_map().get(audience, [])
    if topics:
        idx = slides.index("slide-13.html")
        slides[idx + 1:idx + 1] = topics

    def swap(base_file, audience_map):
        repl = audience_map.get(audience)
        if repl and base_file in slides:
            slides[slides.index(base_file)] = repl

    swap("slide-12.html", app_module.load_audience_desk_file_map())
    swap("slide-13.html", app_module.load_audience_login_file_map())
    swap("slide-09.html", app_module.load_audience_ai_paste_file_map())
    swap("slide-10.html", app_module.load_audience_shadow_ai_file_map())
    swap("slide-19.html", app_module.load_audience_closing_file_map())

    missing = [f for f in slides if not (ROOT / "slides" / f).exists()]
    if missing:
        print(f"ERROR: resolved sequence for '{audience}' references file(s) missing from slides/: {missing}", file=sys.stderr)
        sys.exit(1)

    return slides


async def export_audience_to_pptx(audience, slide_files, output_file, temp_dir):
    total = len(slide_files)
    print(f"[{audience}] resolved {total} slide(s): {slide_files[0]} .. {slide_files[-1]}")

    temp_dir.mkdir(exist_ok=True)

    prs = Presentation()
    prs.slide_width = PPTX_WIDTH_IN
    prs.slide_height = PPTX_HEIGHT_IN

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            args=[
                "--font-render-hinting=none",
                "--disable-lcd-text",
                "--disable-dev-shm-usage",
                "--no-sandbox",
            ]
        )

        context = await browser.new_context(
            viewport={"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT},
            device_scale_factor=SCALE,
        )
        await context.add_init_script(INIT_SCRIPT)

        page = await context.new_page()

        for idx, filename in enumerate(slide_files, start=1):
            # ?audience= forwarded for parity with how the live deck loads every slide
            # (see scripts/deck.js's buildDeck()) - harmless for the now fully
            # self-contained audience-specific files, but still read by a few shared
            # slides no audience map swaps out (e.g. slide-11.html doesn't, and any
            # future shared slide that adds its own audience-aware behavior will
            # pick this up for free without this script needing a change.
            slide_url = f"{SERVER_BASE}/slides/{filename}?audience={audience}"
            pct = (idx - 1) / total * 100
            print(f"  [{pct:5.1f}%]  Capturing slide {idx:02d}/{total}  ...  {slide_url}")

            try:
                await page.goto(slide_url, wait_until="networkidle", timeout=30_000)
                await page.evaluate("() => document.fonts.ready")
                await page.evaluate("""() => Promise.all(
                    Array.from(document.images)
                         .filter(img => !img.complete)
                         .map(img => new Promise(resolve => {
                             img.onload  = resolve;
                             img.onerror = resolve;
                         }))
                )""")
                await asyncio.sleep(1.0)

                image_path = temp_dir / f"slide_{idx:02d}.png"
                await page.screenshot(
                    path=str(image_path),
                    clip={"x": 0, "y": 0, "width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT},
                    full_page=False,
                    animations="disabled",
                    type="png",
                )

                slide_layout = prs.slide_layouts[6]
                slide = prs.slides.add_slide(slide_layout)
                slide.shapes.add_picture(
                    str(image_path), Inches(0), Inches(0),
                    width=prs.slide_width, height=prs.slide_height,
                )

                print(f"           done  Slide {idx:02d} captured ({filename})")

            except Exception as e:
                print(f"           FAILED on {filename}: {e}")
                try:
                    err_path = temp_dir / f"error_{filename.replace('.html', '')}.png"
                    await page.screenshot(path=str(err_path), full_page=False)
                    print(f"             Debug screenshot saved -> {err_path}")
                except Exception:
                    pass

        await browser.close()

    prs.save(output_file)
    shutil.rmtree(temp_dir, ignore_errors=True)
    print(f"[{audience}] Saved: {output_file}  ({total} slides)")


async def main():
    requested = [a for a in sys.argv[1:] if not a.startswith("--")]
    audiences = requested if requested else list(AUDIENCE_OUTPUT_NAMES)
    unknown = [a for a in audiences if a not in AUDIENCE_OUTPUT_NAMES]
    if unknown:
        print(f"ERROR: unknown audience id(s): {unknown}. Known: {list(AUDIENCE_OUTPUT_NAMES)}", file=sys.stderr)
        sys.exit(1)

    for audience in audiences:
        slide_files = resolve_audience_slides(audience)
        output_file = AUDIENCE_OUTPUT_NAMES[audience]
        temp_dir = ROOT / f"temp_slides_{audience.replace('-', '_')}"
        await export_audience_to_pptx(audience, slide_files, output_file, temp_dir)


if __name__ == "__main__":
    asyncio.run(main())
