"""Browser regressions against an already running dev server.

Install Playwright with `python -m pip install playwright` and
`python -m playwright install chromium`, then run:
    python scripts/ui-regression.py --base-url http://127.0.0.1:5173
Use --browser to select an existing Chromium executable.

The React UI and OCR parser are real; worker responses are controlled so races
are reproducible without downloading OCR models or running a large plan.
"""

import argparse
import base64
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


REPO = Path(__file__).resolve().parent.parent
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="
)
MOCK = """
window.__workers = [];
window.Worker = class {
  constructor(url) {
    this.url = String(url);
    this.messages = [];
    this.replied = new Set();
    window.__workers.push(this);
  }
  postMessage(message) { this.messages.push(message); }
  terminate() {}
};
"""


def saved(page):
    return page.evaluate("JSON.parse(localStorage.getItem('riven-roll:session:v1'))")


def screenshot(page, name="probe.png"):
    before = page.evaluate(
        "window.__workers.filter(w=>w.url.includes('ocr.worker')).flatMap(w=>w.messages).filter(m=>m.image).length"
    )
    page.locator('input[type=file]').set_input_files(
        {"name": name, "mimeType": "image/png", "buffer": PNG}
    )
    page.wait_for_function(
        "n=>window.__workers.filter(w=>w.url.includes('ocr.worker')).flatMap(w=>w.messages).filter(m=>m.image).length>n",
        arg=before,
    )


def reply_ocr(page, fixture, index=0, ok=True):
    page.evaluate(
        """({fixture,index,ok})=>{
          const w=window.__workers.find(w=>w.url.includes('ocr.worker'));
          const msg=w.messages.filter(m=>m.image)[index];
          w.onmessage({data:{id:msg.id,ok,...fixture,ms:10,error:'STALE_OCR_ERROR'}});
        }""",
        {"fixture": fixture, "index": index, "ok": ok},
    )
    page.wait_for_timeout(50)


def settle_plans(page):
    # The client keeps one active request and one latest waiting request.
    for _ in range(3):
        page.wait_for_timeout(200)
        page.evaluate(
            """()=>{
              const w=window.__workers.find(w=>w.url.includes('engine.worker'));
              if(!w) return;
              for(const m of [...w.messages]) {
                if(w.replied.has(m.id)) continue;
                w.replied.add(m.id);
                const q={mean:100,p10:10,p25:25,p50:50,p75:75,p90:90};
                const routes=['none','neg'].map((lock,i)=>({
                  route:{action:{kind:'cycle',lock},stepChance:.1,stepCycles:10,
                    stepCyclesP90:22,expected:100,outcomes:[],optimal:i===0},
                  kuva:q,cycles:q,splicers:0,withinBudget:.8
                }));
                w.onmessage({data:{id:m.id,ok:true,done:false,reachable:true,routes,
                  states:1,ms:1,compareValues:m.compare?[100,90]:null}});
              }
            }"""
        )


def run(base_url, browser_path):
    fixture = json.loads((REPO / "src/ocr/fixtures/v3_105_compare.json").read_text(encoding="utf-8"))
    passed = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, **({"executable_path": browser_path} if browser_path else {}))

        def page():
            p = browser.new_page()
            p.add_init_script(MOCK)
            p.route("https://content.warframe.com/**", lambda route: route.fulfill(content_type="image/png", body=PNG))
            p.goto(f"{base_url.rstrip('/')}/?demo=zh")
            p.wait_for_selector(".trait-val")
            p.wait_for_function("window.__workers.some(w=>w.url.includes('engine.worker')&&w.messages.length)")
            return p

        try:
            p = page()
            original = saved(p)["card"]["pos"][0]["shown"]
            field = p.locator(".trait-val").first
            field.fill("999")
            field.press("Escape")
            assert saved(p)["card"]["pos"][0]["shown"] == original
            passed.append("Escape cancels a numeric edit")
            p.close()

            p = page()
            original = saved(p)["card"]["pos"]
            p.locator(".trait-stat").nth(1).click()
            assert p.locator(".picker .opt").filter(has_text="多重射击").first.is_disabled()
            assert saved(p)["card"]["pos"] == original
            passed.append("A trait already used by another row is disabled")
            p.close()

            p = page()
            p.locator(".trait-val").first.fill("")
            p.locator(".trait-val").first.press("Tab")
            p.evaluate("""()=>{
              const w=window.__workers.find(w=>w.url.includes('engine.worker'));
              w.onmessage({data:{id:w.messages[0].id,ok:false,error:'STALE_RESPONSE_PROBE'}});
            }""")
            p.wait_for_timeout(50)
            assert saved(p)["card"]["pos"][0]["shown"] is None
            assert "STALE_RESPONSE_PROBE" not in p.locator("body").inner_text()
            passed.append("An invalidated card rejects a pending plan result")
            p.close()

            p = page()
            screenshot(p)
            p.locator(".card-panel .panel-tools button").nth(1).click()
            reply_ocr(p, fixture)
            assert saved(p)["weaponId"] is None and not saved(p)["card"]["pos"]
            passed.append("Clear rejects a pending screenshot result")
            p.close()

            p = page()
            screenshot(p)
            p.locator('.weapon input[role="combobox"]').fill("Braton")
            p.locator('#weapon-list [role="option"]').first.click()
            weapon = saved(p)["weaponId"]
            image = p.locator(".weapon > img").get_attribute("src")
            reply_ocr(p, fixture)
            assert saved(p)["weaponId"] == weapon
            assert p.locator(".weapon > img").get_attribute("src") == image
            passed.append("Manual weapon and image survive an older OCR result")
            p.close()

            p = page()
            screenshot(p, "first.png")
            screenshot(p, "second.png")
            reply_ocr(p, fixture, index=1)
            current = saved(p)
            status = p.locator(".shot-status").inner_text()
            reply_ocr(p, fixture, index=0, ok=False)
            assert saved(p) == current
            assert p.locator(".shot-status").inner_text() == status
            passed.append("A newer screenshot ignores an older OCR failure")
            p.close()

            p = page()
            screenshot(p)
            reply_ocr(p, fixture)
            settle_plans(p)
            p.wait_for_selector(".compare-h .with-ico")
            assert "次" in p.locator(".compare-h .with-ico").first.inner_text()
            assert p.locator(".compare .with-ico img").count() == 0
            p.get_by_role("button", name="省赤毒", exact=True).click()
            p.wait_for_timeout(50)
            assert p.locator(".compare-h .with-ico").count() == 0
            settle_plans(p)
            assert p.locator(".compare .with-ico img").count() > 0
            passed.append("Comparison units follow objective and hide stale values")
            p.close()

            p = page()
            settle_plans(p)
            p.get_by_role("button", name="省赤毒", exact=True).click()
            p.locator(".card-panel .panel-tools button").first.click()
            settle_plans(p)
            assert saved(p)["target"]["objective"] == "cycles"
            assert p.get_by_role("button", name="省次数", exact=True).get_attribute("aria-pressed") == "true"
            p.get_by_role("button", name="省赤毒", exact=True).click()
            p.locator(".card-panel .panel-tools button").nth(1).click()
            assert saved(p)["target"]["objective"] == "cycles"
            # Choosing the demo makes the reset's sort state visible again.
            p.locator(".card-panel .panel-tools button").first.click()
            settle_plans(p)
            assert p.get_by_role("button", name="省次数", exact=True).get_attribute("aria-pressed") == "true"
            passed.append("Demo and Clear reset both the objective and its sort control")
            p.close()

            for text in ["暴率或伤害 负任意", "暴率；伤害 负任意"]:
                p = page()
                p.locator(".quick-input").fill(text)
                p.locator(".quick-input").press("Enter")
                settle_plans(p)
                damage = "WeaponDamageAmountMod"
                assert damage not in saved(p)["target"]["allowedNeg"]
                assert p.locator(".chips").get_by_role("button", name="伤害", exact=True).count() == 0
                allowed = p.evaluate("""()=>{
                  const w=window.__workers.find(w=>w.url.includes('engine.worker'));
                  return w.messages.at(-1).target.allowedNeg;
                }""")
                assert damage not in allowed
                passed.append(f"All positive alternatives remain excluded from negatives: {text}")
                p.close()

            p = page()
            p.wait_for_timeout(2600)
            assert not p.evaluate("window.__workers.some(w=>w.url.includes('ocr.worker'))")
            passed.append("An idle visit does not initialize OCR")
            p.close()
        finally:
            browser.close()
    return passed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:5173")
    parser.add_argument("--browser", help="Chromium executable (otherwise Playwright's installation)")
    args = parser.parse_args()
    print(json.dumps({"passed": run(args.base_url, args.browser)}, ensure_ascii=False, indent=2))
