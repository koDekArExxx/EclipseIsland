"""Optional asset rebuild: Playwright + Pillow, with ECLIPSE_CHECK_BROWSER if needed."""
from pathlib import Path
from io import BytesIO
import os
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    extra=dict(executable_path=os.environ['ECLIPSE_CHECK_BROWSER']) if os.environ.get('ECLIPSE_CHECK_BROWSER') else {}
    browser=p.chromium.launch(headless=True,args=['--no-sandbox','--no-zygote','--single-process','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],**extra)
    page=browser.new_page(viewport=dict(width=500,height=300),device_scale_factor=1)
    def route(request):
        name=request.request.url.split('eclipse.test/',1)[1]
        file=ROOT/name
        request.fulfill(body=file.read_bytes(),content_type='image/png' if file.suffix=='.png' else 'text/html')
    page.route('http://eclipse.test/**',route)
    page.goto('http://eclipse.test/build/splash.html')
    page.locator('img').evaluate('(img)=>img.decode()')
    Image.open(BytesIO(page.screenshot())).convert('RGB').save(ROOT/'build/splash.bmp')
    browser.close()
