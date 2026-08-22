import asyncio
import json
import time
from pathlib import Path

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError


URL = "https://roth-retirement-tool.preview.emergentagent.com"
PIN = "140431"
OUT = Path("/app/test_reports/pdf_downloads")
OUT.mkdir(parents=True, exist_ok=True)


async def login_if_needed(page):
    await page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    await page.wait_for_timeout(1000)
    if await page.get_by_test_id("lock-screen").count():
        await page.get_by_test_id("login-mode-master").click()
        await page.wait_for_timeout(200)
        await page.get_by_test_id("pin-input").click()
        await page.keyboard.type(PIN)
        try:
            await page.get_by_test_id("pin-unlock-btn").click(timeout=1000)
        except Exception:
            pass
    await page.get_by_test_id("main-tabs").wait_for(state="visible", timeout=30000)


def assert_pdf(path: Path, expected_name: str):
    data = path.read_bytes()
    assert path.name == expected_name, f"filename mismatch: {path.name} != {expected_name}"
    assert data.startswith(b"%PDF-"), f"{path.name} missing PDF magic: {data[:8]!r}"
    assert len(data) > 100 * 1024, f"{path.name} too small: {len(data)} bytes"
    return {"name": path.name, "size": len(data), "magic": data[:8].decode("latin1")}


async def main():
    result = {
        "url": URL,
        "whitepaper": None,
        "presentation": None,
        "console_errors": [],
        "page_errors": [],
        "style_checks": {},
    }
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(accept_downloads=True, viewport={"width": 1920, "height": 1080})
        page = await context.new_page()
        page.on("console", lambda msg: result["console_errors"].append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: result["page_errors"].append(str(exc)))

        await login_if_needed(page)

        # White Paper flow
        await page.get_by_test_id("tab-whitepaper").click()
        await page.get_by_test_id("whitepaper-download-pdf").wait_for(state="visible", timeout=30000)
        white_url_before = page.url
        async with page.expect_download(timeout=180000) as dlinfo:
            await page.get_by_test_id("whitepaper-download-pdf").click()
        dl = await dlinfo.value
        white_path = OUT / dl.suggested_filename
        await dl.save_as(str(white_path))
        result["whitepaper"] = assert_pdf(white_path, "roth-conversion-white-paper.pdf")
        assert page.url == white_url_before, "page navigated during White Paper download"
        body_after_white = await page.evaluate("() => document.body.className")
        assert "print-whitepaper-standalone" not in body_after_white, body_after_white

        # Presentation flow
        await page.get_by_test_id("tab-presentation").click()
        await page.get_by_test_id("presentation-print-btn").wait_for(state="visible", timeout=30000)
        await page.wait_for_function(
            """() => {
                const btn = document.querySelector('[data-testid="presentation-print-btn"]');
                return btn && !btn.disabled && /Generate PDF/.test(btn.textContent || '');
            }""",
            timeout=90000,
        )
        await page.get_by_test_id("presentation-preview-inner").wait_for(state="visible", timeout=30000)
        pres_url_before = page.url
        initial_style = await page.evaluate(
            """() => {
                const wrap = document.querySelector('[data-testid="presentation-preview-wrap"]');
                return {transform: wrap?.style.transform || '', width: wrap?.style.width || ''};
            }"""
        )
        assert initial_style["transform"] == "scale(0.7)", initial_style

        observed = []
        async def poll_style():
            end = time.time() + 180
            while time.time() < end:
                observed.append(await page.evaluate(
                    """() => {
                        const wrap = document.querySelector('[data-testid="presentation-preview-wrap"]');
                        return {transform: wrap?.style.transform || '', width: wrap?.style.width || ''};
                    }"""
                ))
                await page.wait_for_timeout(50)

        poll_task = asyncio.create_task(poll_style())
        async with page.expect_download(timeout=180000) as dlinfo2:
            await page.get_by_test_id("presentation-print-btn").click()
        dl2 = await dlinfo2.value
        poll_task.cancel()
        try:
            await poll_task
        except BaseException:
            pass
        pres_path = OUT / dl2.suggested_filename
        await dl2.save_as(str(pres_path))
        result["presentation"] = assert_pdf(pres_path, "client-roth-plan.pdf")
        assert page.url == pres_url_before, "page navigated during Presentation download"

        final_style = await page.evaluate(
            """() => {
                const wrap = document.querySelector('[data-testid="presentation-preview-wrap"]');
                return {transform: wrap?.style.transform || '', width: wrap?.style.width || ''};
            }"""
        )
        body_after_pres = await page.evaluate("() => document.body.className")
        result["style_checks"] = {
            "initial": initial_style,
            "final": final_style,
            "observed_unscaled": any(x.get("transform") == "none" for x in observed),
            "observed_samples": observed[:3] + observed[-3:],
            "body_after_white": body_after_white,
            "body_after_pres": body_after_pres,
        }
        assert final_style["transform"] == "scale(0.7)", final_style
        assert final_style["width"] == "142.85%", final_style
        assert "print-whitepaper-standalone" not in body_after_pres, body_after_pres
        assert "print-presentation" not in body_after_pres, body_after_pres
        assert not result["console_errors"], result["console_errors"]
        assert not result["page_errors"], result["page_errors"]

        await browser.close()

    (OUT / "result.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
