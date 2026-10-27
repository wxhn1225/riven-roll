// Paste-flow smoke test against the dev server: loads a screenshot, waits for OCR and routes, zooms, edits the weapon.
// Usage: node scripts/smoke.mjs <screenshot.png> <out.png> [mobile]
import { chromium, devices } from "@playwright/test";

const [img, out, mobile] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "msedge" });
const ctx = await browser.newContext(mobile ? { ...devices["iPhone 13"] } : { viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on("console", (m) => m.type() === "error" && console.log("console error:", m.text()));
await page.goto("http://localhost:5173/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.setInputFiles('input[type="file"]', img);
await page.waitForSelector(".shot-status:not(.busy)", { timeout: 90000 });
await page.waitForSelector(".route, .compare, .empty", { timeout: 60000 });
await page.waitForTimeout(2500);
console.log("status:", await page.textContent(".shot-status").catch(() => null));
console.log("weapon:", await page.getAttribute(".weapon input", "placeholder"), await page.getAttribute(".weapon img.weapon-img", "src"));
console.log("overflow:", await page.evaluate(() => document.documentElement.scrollWidth - innerWidth));
await page.screenshot({ path: out, fullPage: !mobile });
if (!mobile) {
  await page.click(".shot-img");
  await page.waitForTimeout(400);
  await page.screenshot({ path: out.replace(".png", "-zoom.png") });
  await page.keyboard.press("Escape");
  // change weapon by hand: the image must follow
  await page.fill(".weapon input", "Lex");
  await page.waitForSelector(".weapon-list [role=option]");
  await page.locator(".weapon-list [role=option]").first().dispatchEvent("mousedown");
  await page.waitForTimeout(800);
  console.log("after edit:", await page.getAttribute(".weapon input", "placeholder"), await page.getAttribute(".weapon img.weapon-img", "src"));
}
await browser.close();
