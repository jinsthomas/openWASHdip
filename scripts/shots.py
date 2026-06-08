"""Capture README screenshots from the running app (http://127.0.0.1:8000)."""
import asyncio
from playwright.async_api import async_playwright

OUT = "docs/screenshots"


async def shot(page, name):
    await page.screenshot(path=f"{OUT}/{name}.png")
    print(f"  ✓ {name}.png")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1440, "height": 880}, device_scale_factor=1)
        await page.goto("http://127.0.0.1:8000/", wait_until="networkidle")
        await page.wait_for_timeout(2500)
        await shot(page, "01-canvas")  # landing: node canvas + standard-source catalog

        try:  # column mapping drawer (clicking a catalog source opens the Map node)
            await page.locator(".catitem").first.click()
            await page.wait_for_timeout(2500)
            await shot(page, "02-mapping")
        except Exception as e:
            print("  ! mapping:", e)

        try:  # unified All data -> Charts by country
            await page.get_by_role("button", name="All data").click()
            await page.wait_for_timeout(1500)
            await page.get_by_role("button", name="Charts", exact=True).click()
            await page.wait_for_timeout(700)
            await page.locator(".ucbar select").select_option("country")
            await page.wait_for_timeout(1800)
            await shot(page, "03-unified-charts")
        except Exception as e:
            print("  ! charts:", e)

        try:  # unified map (source-colored)
            await page.get_by_role("button", name="Map", exact=True).click()
            await page.wait_for_timeout(4000)
            await shot(page, "04-unified-map")
        except Exception as e:
            print("  ! map:", e)

        await browser.close()


asyncio.run(main())
