"""
Export the combined "Technology Team" deck (IT Support + IT Admin + Development)
to a Synergy-branded .pptx file.

Restructured to closely mirror the "Cybersecurity Hygiene & AI Systems Security"
reference playbook (Cybersecurity PPT.pdf) instead of the general awareness-month
deck's flow: one continuous technical/architecture narrative (CIA Triad ->
Enterprise Hygiene -> Phishing & Verification -> Endpoint/Network -> Data
Classification -> Secrets/Git/AppSec -> AI Security Architecture -> Golden
Rules), not scenario-based awareness content. The general deck's Deepfake,
Phishing Evolution, Pasting-Data-Into-AI, Shadow AI, Desk/Login Perimeter, and
See-Something-Say-Something slides are deliberately NOT included here - this
is a distinct, standalone deck alongside the existing separate IT Support and
Development PPTX exports (export_audience_slides.py) and the original
scenario-based Technology Team cut; it does not replace either.

Reuses 9 existing slides/ files as-is or via a one-line bridge-text patch
(since their surrounding sequence changed) - patched copies live in
slides-tech-team/ prefixed tt2-* rather than editing the production files.
The other ~12 slides are new, built specifically for this reference-aligned
flow, following the same Synergy tell-card/hero visual house style as
everything else in slides-tech-team/.

Renders every slide directly via file:// URLs (no Flask server needed - all
of these are static pages with no fetch() calls), same capture approach as
export_slides.py / export_audience_slides.py / export_general_clean_slides.py.

Usage:
    python export_tech_team_slides.py

Requires: playwright (with `playwright install chromium` run once),
python-pptx. Both already available in this project's environment.
"""

import asyncio
import shutil
import sys
from pathlib import Path
from urllib.request import pathname2url

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from playwright.async_api import async_playwright
from pptx import Presentation
from pptx.util import Inches

from export_slides import (
    INIT_SCRIPT,
    PPTX_HEIGHT_IN,
    PPTX_WIDTH_IN,
    SCALE,
    VIEWPORT_HEIGHT,
    VIEWPORT_WIDTH,
)

ROOT = Path(__file__).resolve().parent
TECH_TEAM_DIR = ROOT / "slides-tech-team"
OUTPUT_FILE = "Synergy_Cyber_Security_Awareness_Month_Technology_Team.pptx"
TEMP_DIR = ROOT / "temp_slides_tech_team"

# (folder, filename) pairs, in final presentation order - mirrors the reference
# playbook's own page order almost 1:1. All slides now live in slides-tech-team/
# as dedicated files (no more direct reuse of slides/*.html): the original IT
# Support/Development audience versions carried extra cards, stale progress-
# tracks, and Fault-Finding/Decision-Room callbacks specific to their own
# 6-slide mini-course context, none of which apply to this reference-aligned
# flow - each was rebuilt here to match the reference playbook's own item
# count and wording exactly, still in the shared Synergy tell-card house style.
SLIDE_SEQUENCE = [
    (TECH_TEAM_DIR, "tech-team-opening.html"),
    (TECH_TEAM_DIR, "tech-team-cia-triad.html"),
    (TECH_TEAM_DIR, "tech-team-enterprise-hygiene.html"),
    (TECH_TEAM_DIR, "tech-team-phishing-verification.html"),
    (TECH_TEAM_DIR, "tech-team-device-hardening.html"),
    (TECH_TEAM_DIR, "tech-team-zero-trust-network.html"),
    (TECH_TEAM_DIR, "tech-team-data-classification.html"),
    (TECH_TEAM_DIR, "tech-team-secrets-architecture.html"),
    (TECH_TEAM_DIR, "tech-team-git-lifecycle.html"),
    (TECH_TEAM_DIR, "tech-team-appsec.html"),
    (TECH_TEAM_DIR, "tech-team-dual-ai-perspectives.html"),
    (TECH_TEAM_DIR, "tech-team-ai-paradigm-shifts.html"),
    (TECH_TEAM_DIR, "tech-team-ai-code-audit.html"),
    (TECH_TEAM_DIR, "tech-team-prompt-masking.html"),
    (TECH_TEAM_DIR, "tech-team-prompt-injection.html"),
    (TECH_TEAM_DIR, "tech-team-ai-gateway-pipeline.html"),
    (TECH_TEAM_DIR, "tech-team-token-economics.html"),
    (TECH_TEAM_DIR, "tech-team-rag-security.html"),
    (TECH_TEAM_DIR, "tech-team-telemetry-masking.html"),
    (TECH_TEAM_DIR, "tech-team-golden-rules.html"),
    (TECH_TEAM_DIR, "tech-team-closing.html"),
]


async def export_to_pptx():
    total = len(SLIDE_SEQUENCE)
    missing = [str(folder / name) for folder, name in SLIDE_SEQUENCE if not (folder / name).exists()]
    if missing:
        print(f"ERROR: missing file(s): {missing}", file=sys.stderr)
        sys.exit(1)
    print(f"Technology Team sequence: {total} slides")

    TEMP_DIR.mkdir(exist_ok=True)

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

        for idx, (folder, filename) in enumerate(SLIDE_SEQUENCE, start=1):
            file_path = folder / filename
            slide_url = "file://" + pathname2url(str(file_path))
            pct = (idx - 1) / total * 100
            print(f"  [{pct:5.1f}%]  Capturing slide {idx:02d}/{total}  ...  {filename}")

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

                image_path = TEMP_DIR / f"slide_{idx:02d}.png"
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
                    err_path = TEMP_DIR / f"error_{filename.replace('.html', '')}.png"
                    await page.screenshot(path=str(err_path), full_page=False)
                    print(f"             Debug screenshot saved -> {err_path}")
                except Exception:
                    pass

        await browser.close()

    prs.save(OUTPUT_FILE)
    shutil.rmtree(TEMP_DIR, ignore_errors=True)
    print(f"Saved: {OUTPUT_FILE}  ({total} slides)")


if __name__ == "__main__":
    asyncio.run(export_to_pptx())
