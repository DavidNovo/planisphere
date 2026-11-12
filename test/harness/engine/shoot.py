"""Builds the engine harness and screenshots the scenarios at 1440x900 into out/."""
import json, pathlib, subprocess, sys
from playwright.sync_api import sync_playwright

here = pathlib.Path(__file__).parent.resolve()
out = here / "out"
subprocess.run(["node", str(here / "build.mjs")], check=True)
url = "file://" + str(out / "harness.html")
only = set(sys.argv[1:])

def want(name):
    return not only or name in only

def load(page, params=""):
    page.goto(f"{url}?{params}")
    page.wait_for_function("window.__ready === true", timeout=60000)
    page.wait_for_timeout(2500)

def ev(page, js):
    return page.evaluate(js)

def at(page, node_id):
    return page.evaluate(f"window.__sky.where({json.dumps(node_id)})")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--disable-gpu"])
    page = b.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    load(page)
    stats = ev(page, "window.__sky.engine.getStats()")
    print("nodes", stats["nodes"], "edges", stats["edges"], "clusters", [(c["name"], c["count"]) for c in stats["clusters"]])
    hub = ev(page, "window.__sky.top('note', 3)")
    print("hubs", hub)
    if want("01-default"):
        page.screenshot(path=str(out / "01-default.png"))

    pt = at(page, hub[0])
    if want("02-hover"):
        page.mouse.move(pt["x"], pt["y"])
        page.wait_for_timeout(700)
        page.screenshot(path=str(out / "02-hover.png"))

    if want("03-selected"):
        page.mouse.move(pt["x"], pt["y"])
        page.mouse.down(); page.mouse.up()
        page.mouse.move(pt["x"] + 380, pt["y"] + 260)
        page.wait_for_timeout(900)
        page.screenshot(path=str(out / "03-selected.png"))
        ev(page, "window.__sky.engine.select(null)")

    if want("04-find-recipe"):
        ev(page, "window.__sky.engine.highlight('recipe')")
        page.mouse.move(5, 5)
        page.wait_for_timeout(1400)
        page.screenshot(path=str(out / "04-find-recipe.png"))
        ev(page, "window.__sky.engine.highlight('')")

    if want("05-local-depth2"):
        ev(page, f"window.__sky.engine.setLocal({json.dumps(hub[1])}, 2)")
        page.wait_for_timeout(1800)
        page.screenshot(path=str(out / "05-local-depth2.png"))
        ev(page, "window.__sky.engine.setLocal(null, 2)")
        page.wait_for_timeout(600)

    if want("08-people-gold"):
        people = ev(page, "window.__sky.top('person', 40)")
        # zoom on the people with the most links
        cx = ev(page, """(() => { const s = window.__sky.engine.internals(); const ps = s.layout.nodes.filter(n => n.person); const x = ps.reduce((a,n)=>a+n.x,0)/ps.length, y = ps.reduce((a,n)=>a+n.y,0)/ps.length; return {x,y}; })()""")
        ev(page, f"(() => {{ const s = window.__sky.engine.internals().st; s.camTarget = {{x:{cx['x']}, y:{cx['y']}, k:1.5}}; s.cam = {{...s.camTarget}}; }})()")
        page.wait_for_timeout(900)
        page.screenshot(path=str(out / "08-people-gold.png"))

    perf = {}
    perf["default"] = ev(page, "window.__sky.bench(40)")
    print("draw ms/frame at", stats["nodes"], "nodes:", round(perf["default"], 1))

    if want("06-paper"):
        load(page, "theme=paper")
        page.screenshot(path=str(out / "06-paper.png"))
        hub2 = ev(page, "window.__sky.top('note', 3)")
        pt2 = at(page, hub2[1])
        page.mouse.move(pt2["x"], pt2["y"])
        page.wait_for_timeout(700)
        page.screenshot(path=str(out / "06b-paper-hover.png"))

    if want("07-stress"):
        load(page, "scale=5.6")
        st = ev(page, "window.__sky.engine.getStats()")
        print("stress nodes", st["nodes"], "edges", st["edges"], "clusters", len(st["clusters"]))
        page.screenshot(path=str(out / "07-stress-5000.png"))
        perf["stress"] = ev(page, "window.__sky.bench(30)")
        print("draw ms/frame at", st["nodes"], "nodes:", round(perf["stress"], 1))
        top = ev(page, "window.__sky.top('any', 1)")[0]
        ev(page, f"window.__sky.engine.select({json.dumps(top)}, {{pan: true}})")
        ev(page, "(() => { const s = window.__sky.engine.internals().st; s.camTarget = {...s.camTarget, k: 0.9}; s.cam = {...s.camTarget}; })()")
        page.wait_for_timeout(900)
        page.screenshot(path=str(out / "07b-stress-zoomed.png"))
        perf["stress_zoomed"] = ev(page, "window.__sky.bench(30)")
        print("zoomed draw ms/frame:", round(perf["stress_zoomed"], 1))

    (out / "perf.json").write_text(json.dumps(perf, indent=1))
    print("errors:", errors)
    b.close()
