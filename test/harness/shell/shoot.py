"""Builds the shell harness and screenshots the scenarios at 1440x900 and 900x700."""
import subprocess, pathlib
from playwright.sync_api import sync_playwright

here = pathlib.Path(__file__).parent.resolve()
out = here / "out"
subprocess.run(["node", str(here / "build.mjs")], check=True)
url = "file://" + str(out / "harness.html")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    errors = []
    def load(page, params=""):
        page.goto(f"{url}?{params}")
        page.wait_for_function("window.__ready === true", timeout=20000)
        page.wait_for_timeout(500)
    def select(page, nid):
        page.evaluate("id => window.__ns.view.engine.select(id)", nid)
        page.wait_for_timeout(300)
    for (w, h, tag) in [(1440, 900, "wide"), (900, 700, "mid")]:
        page = b.new_page(viewport={"width": w, "height": h})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        load(page); page.screenshot(path=str(out / f"{tag}-01-default.png"))
        select(page, "Projects/Night Sky.md"); page.screenshot(path=str(out / f"{tag}-02-selected-note.png"))
        select(page, "People/Ada Lovelace.md"); page.screenshot(path=str(out / f"{tag}-03-selected-person.png"))
        select(page, None)
        page.click(".ns-anchor .ns-btn"); page.fill(".ns-popover .ns-chip-input >> nth=0", "Pro"); page.wait_for_timeout(200)
        page.screenshot(path=str(out / f"{tag}-04-filters-suggest.png"))
        page.keyboard.press("Enter"); page.fill(".ns-popover .ns-chip-input >> nth=2", "p"); page.wait_for_timeout(200)
        page.screenshot(path=str(out / f"{tag}-05-filters-tags.png"))
        page.keyboard.press("Escape"); page.keyboard.press("Escape")
        load(page, "mode=local"); page.screenshot(path=str(out / f"{tag}-06-local.png"))
        load(page, "mode=local&scenario=local-none"); page.screenshot(path=str(out / f"{tag}-07-local-hint.png"))
        load(page, "scenario=empty"); page.screenshot(path=str(out / f"{tag}-08-empty.png"))
        load(page, "scenario=nomatch"); page.screenshot(path=str(out / f"{tag}-09-nomatch.png"))
        load(page, "theme=paper&chrome=light"); select(page, "People/Grace Hopper.md"); page.screenshot(path=str(out / f"{tag}-10-light-paper.png"))
        page.close()
    for w in (500, 640):
        page = b.new_page(viewport={"width": w, "height": 760})
        page.on("pageerror", lambda e: errors.append(str(e)))
        load(page); page.screenshot(path=str(out / f"narrow-{w}-01.png"))
        select(page, "Projects/Night Sky.md"); page.screenshot(path=str(out / f"narrow-{w}-02-selected.png"))
        page.click(".ns-panel .ns-icon-btn[aria-label='Hide panel']") if page.query_selector(".ns-panel .ns-icon-btn[aria-label='Hide panel']") else None
        page.click(".ns-anchor .ns-btn"); page.wait_for_timeout(200); page.screenshot(path=str(out / f"narrow-{w}-03-filters.png"))
        page.close()
    print("errors:", errors)
    b.close()
