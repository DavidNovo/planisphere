import pathlib
from playwright.sync_api import sync_playwright
out = pathlib.Path(__file__).parent.resolve() / "out"
url = "file://" + str(out / "harness.html")
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    errors = []
    page = b.new_page(viewport={"width": 1440, "height": 900})
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(url)
    page.wait_for_function("window.__ready === true", timeout=20000)
    page.wait_for_timeout(2500)
    page.screenshot(path=str(out / "c-01-default.png"))
    page.evaluate("window.__ns.view.engine.select('Projects/Night Sky.md', {pan:true})")
    page.wait_for_timeout(900)
    page.screenshot(path=str(out / "c-02-selected.png"))
    page.evaluate("window.__ns.view.engine.select('People/Ada Lovelace.md', {pan:true})")
    page.wait_for_timeout(900)
    page.screenshot(path=str(out / "c-03-person.png"))
    print("stats", page.evaluate("JSON.stringify(window.__ns.view.engine.getStats())")[:400])
    print("errors", errors)
