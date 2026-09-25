"""
Export the combined "Technology Team" deck (IT Support + IT Admin + Development,
smart-merged, no duplicates) to a Synergy-branded .pptx file.

This is a third, standalone deck alongside the existing separate IT Support and
Development PPTX exports (export_audience_slides.py) - it does not replace
them. It reuses the shared general slides (Opening, Why Cybersecurity Matters
Now, When Attackers Use AI Too, See Something Say Something) unchanged, uses 7
new merged slides in slides-tech-team/ for the sections where IT's and Dev's
own reframed content differed (Threat Landscape, Deepfake, Phishing, Pasting
Data Into AI, Shadow AI, Desk Perimeter, Login Perimeter), then runs IT
Support's 6 deep-dive topic slides followed by Development's 6 deep-dive topic
slides (kept separate - they're genuinely different technical domains), then
a merged Closing slide with chips from both. Two of the original files needed
a one-line "Next" bridge-text fix for this sequence (slide-14's bridge
originally pointed at GDPR, and slide-it-golden-rules' bridge originally
pointed at "See Something, Say Something" - both wrong once Dev's section
or the merged Closing slide comes next instead) - rather than edit those
production files, patched copies live in slides-tech-team/ instead
(slide-14-bridge-fix.html, it-golden-rules-bridge-fix.html).

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
SLIDES_DIR = ROOT / "slides"
TECH_TEAM_DIR = ROOT / "slides-tech-team"
OUTPUT_FILE = "Synergy_Cyber_Security_Awareness_Month_Technology_Team.pptx"
TEMP_DIR = ROOT / "temp_slides_tech_team"

# (folder, filename) pairs, in final presentation order.
SLIDE_SEQUENCE = [
    (SLIDES_DIR, "slide-01.html"),
    (SLIDES_DIR, "slide-02.html"),
    (TECH_TEAM_DIR, "tech-team-threat-landscape.html"),
    (TECH_TEAM_DIR, "tech-team-deepfake.html"),
    (TECH_TEAM_DIR, "tech-team-phishing.html"),
    (TECH_TEAM_DIR, "tech-team-ai-data-paste.html"),
    (TECH_TEAM_DIR, "tech-team-shadow-ai.html"),
    (SLIDES_DIR, "slide-11.html"),
    (TECH_TEAM_DIR, "tech-team-desk-perimeter.html"),
    (TECH_TEAM_DIR, "tech-team-login-perimeter.html"),
    (SLIDES_DIR, "slide-it-hygiene.html"),
    (SLIDES_DIR, "slide-it-data-classification.html"),
    (SLIDES_DIR, "slide-it-endpoint.html"),
    (SLIDES_DIR, "slide-it-network.html"),
    (SLIDES_DIR, "slide-it-ai-leakage.html"),
    (TECH_TEAM_DIR, "it-golden-rules-bridge-fix.html"),
    (SLIDES_DIR, "slide-dev-appsec.html"),
    (SLIDES_DIR, "slide-dev-secrets.html"),
    (SLIDES_DIR, "slide-dev-git-lifecycle.html"),
    (SLIDES_DIR, "slide-dev-ai-audit.html"),
    (SLIDES_DIR, "slide-dev-prompt-injection.html"),
    (SLIDES_DIR, "slide-dev-golden-rules.html"),
    (TECH_TEAM_DIR, "slide-14-bridge-fix.html"),
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
