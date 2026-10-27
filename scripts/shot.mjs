// Screenshots of the running dev server with the installed Edge (no browser download).
// Usage: node scripts/shot.mjs <url> <out.png> [width] [height] [mobile]
import { chromium, devices } from "@playwright/test";

const [url, out, w = "1440", h = "900", mobile] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "msedge" });
const context = await browser.newContext(mobile ? { ...devices["iPhone 13"] } : { viewport: { width: Number(w), height: Number(h) } });
const page = await context.newPage();
page.on("console", (m) => m.type() === "error" && console.log("console error:", m.text()));
await page.goto(url);
await page.waitForSelector(".routes tbody tr, .warn, .article", { timeout: 30000 }).catch(() => console.log("no routes rendered"));
await page.waitForTimeout(500);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
console.log("horizontal overflow px:", overflow);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
