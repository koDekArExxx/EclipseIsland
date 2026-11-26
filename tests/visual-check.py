"""Optional real Chromium regression check. Requires playwright and pillow; not an app dependency."""
from pathlib import Path
from io import BytesIO
import base64
import json
import mimetypes
import os
import subprocess
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'src'
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)
settings = json.loads(subprocess.check_output(['node', '-p', 'JSON.stringify(require("./electron/settings.cjs").defaults)'], cwd=ROOT))
settings.update(sounds=False, hoverExpand=False)
media = dict(available=True, active=True, trackKey='visual-fixture', title='Ночной рейс', artist='Eclipse Test', source='Spotify.exe', playing=True, position=42, duration=180, canToggle=True, canNext=True, canPrevious=True, canSeek=True)
initial = dict(settings=settings, media=media, weather=dict(status='empty'), platform='win32', nativeBlur=False, shortcuts={}, monitors=[], autostart={})
initializer = '''
const state=INITIAL;
let listener;
window.__geometry=[];
window.island={
  init:async()=>state,
  on:fn=>{listener=fn;},
  save:async settings=>{state.settings=settings;listener({type:'settings',value:settings});return settings;},
  bounds:value=>window.__geometry.push(value),
  media:async()=>({ok:true}),showSettings:()=>{},minimize:()=>{},close:()=>{},quit:()=>{},
  refreshWeather:async()=>{},cities:async()=>({ok:true,items:[]}),selectCity:async()=>{}
};
window.__dispatch=(type,value)=>{if(type==='settings')state.settings=value;listener({type,value});};
'''.replace('INITIAL', json.dumps(initial, ensure_ascii=False))

def route_local(route):
    name = route.request.url.split('eclipse.test/', 1)[1].split('?')[0]
    file = (SRC / name).resolve()
    if file.is_relative_to(SRC) and file.is_file():
        route.fulfill(body=file.read_bytes(), content_type=mimetypes.guess_type(file)[0] or 'application/octet-stream')
    else:
        route.abort()

def assert_clear(data, expanded=False):
    image = Image.open(BytesIO(data)).convert('RGBA')
    for point in [(1, 1), (598, 1), (1, 448), (598, 448), (300, 420), (20, 200), (580, 200)]:
        assert image.getpixel(point)[3] == 0, ('opaque overlay margin', point, image.getpixel(point))
    return image

with sync_playwright() as p:
    extra = dict(executable_path=os.environ['ECLIPSE_CHECK_BROWSER']) if os.environ.get('ECLIPSE_CHECK_BROWSER') else {}
    browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--no-zygote', '--single-process', '--disable-dev-shm-usage', '--in-process-gpu', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=AudioServiceOutOfProcess'], **extra)
    page = browser.new_page(viewport=dict(width=600, height=450), device_scale_factor=1)
    page.add_init_script(initializer)
    errors=[]
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('http://eclipse.test/**', route_local)
    page.goto('http://eclipse.test/overlay.html?view=overlay')
    page.wait_for_selector('.island')
    alphas={}
    for ui in ['modern', 'liquid', 'frosted']:
        for mode in ['modern', 'liquid', 'frosted']:
            prefs={**settings, 'uiRenderer':ui, 'islandRenderer':mode}
            page.evaluate('(value)=>window.__dispatch("settings",value)', prefs)
            page.wait_for_timeout(80)
            image_bytes=page.screenshot(omit_background=True)
            image=assert_clear(image_bytes)
            box=page.locator('.island').bounding_box()
            assert round(box['width'])==328, box
            assert page.evaluate('[document.documentElement,document.body,document.querySelector("#app"),document.querySelector(".overlay-root")].every(el=>getComputedStyle(el).backgroundColor==="rgba(0, 0, 0, 0)")')
            if mode=='liquid':
                assert page.locator('.island').evaluate('(el)=>getComputedStyle(el).backdropFilter')=='none'
            if ui=='modern':
                (OUT / f'overlay-{mode}.png').write_bytes(image_bytes)
                alphas[mode]=image.getpixel((300, 68))[3]
    assert alphas['liquid'] < alphas['modern']-80, alphas
    page.evaluate('(value)=>window.__dispatch("settings",value)', {**settings, 'islandRenderer':'liquid'})
    page.locator('[data-expand]').click()
    page.wait_for_timeout(780)
    assert round(page.locator('.island').bounding_box()['width'])==446
    assert_clear(page.screenshot(path=OUT/'overlay-expanded.png', omit_background=True), expanded=True)
    page.locator('[data-island-tab="music"]').click()
    assert page.locator('[data-track-title]').inner_text()=='Ночной рейс'
    page.evaluate('window.__dispatch("view-visible",false)')
    assert page.locator('html').evaluate('(el)=>el.classList.contains("ui-paused")')
    page.evaluate('window.__dispatch("view-visible",true)')
    assert not page.locator('html').evaluate('(el)=>el.classList.contains("ui-paused")')
    # Rasterize at actual zoom and monitor pixel density, without bitmap enlargement.
    page.locator('[data-collapse]').click()
    page.wait_for_timeout(750)
    scale_checks=0
    for dpr in [1, 1.25, 2]:
        check=browser.new_page(viewport=dict(width=600,height=450),device_scale_factor=dpr)
        check.add_init_script(initializer)
        check.route('http://eclipse.test/**',route_local)
        check.goto('http://eclipse.test/overlay.html?view=overlay')
        check.wait_for_selector('.island')
        check.on('pageerror',lambda error: errors.append(str(error)))
        assert check.evaluate('devicePixelRatio')==dpr
        for scale in [80, 100, 120]:
            for mode in ['modern','liquid','frosted']:
                check.evaluate('(v)=>window.__dispatch("settings",v)',{**settings,'scale':scale,'islandRenderer':mode})
                check.wait_for_timeout(100)
                box=check.locator('.island').bounding_box()
                assert abs(box['width']-328*scale/100)<1,box
                assert check.locator('.island').evaluate('(el)=>getComputedStyle(el).transform')=='none'
                bitmap=Image.open(BytesIO(check.screenshot(omit_background=True))).convert('RGBA')
                assert bitmap.getpixel((1,1))[3]==0
                assert bitmap.getpixel((bitmap.width-2,bitmap.height-2))[3]==0
                scale_checks+=1
    page.set_viewport_size(dict(width=1180,height=830))
    page.goto('http://eclipse.test/index.html')
    page.wait_for_selector('.sidebar')
    assert page.locator('select,input[type=color]').count()==0
    page.locator('[data-setting="autoLaunch"]').locator('..').locator('button').click()
    page.get_by_role('option',name='Нет',exact=False).click()
    assert page.locator('[data-setting="autoLaunch"]').input_value()=='false'
    page.locator('.sidebar [data-nav="appearance"]').click()
    page.locator('[data-color-target="customAccent"]').scroll_into_view_if_needed()
    page.locator('[data-color-target="customAccent"]').click()
    assert page.locator('.color-trigger .press-wave').count()==0
    page.locator('[data-picker-hex]').fill('#bf79ff')
    page.locator('[data-picker-rgb="0"]').fill('120')
    page.locator('[data-picker-rgb="0"]').dispatch_event('input')
    page.wait_for_timeout(300)
    page.screenshot(path=OUT/'settings-color-picker.png')
    box=page.locator('.color-popover').bounding_box()
    assert box['x']>=12 and box['y']>=12 and box['x']+box['width']<=1180 and box['y']+box['height']<=830,box
    page.locator('[data-picker-apply]').click()
    assert page.locator('[data-setting="customAccent"]').input_value()=='#7879ff'
    assert page.locator('[data-inline-hex="customAccent"]').input_value()=='#7879ff'
    page.locator('[data-reset-theme]').click()
    assert page.locator('[data-setting="customAccent"]').input_value()==settings['customAccent']
    assert page.locator('[data-setting="autoLaunch"]').count()==0
    for mode in ['modern','liquid','frosted']:
        page.locator(f'[data-renderer-preset="{mode}"]').click()
        assert page.locator('html').get_attribute('data-ui-renderer')==mode
    page.wait_for_timeout(500)
    page.screenshot(path=OUT/'settings-materials.png')
    # Real decoded art: CSS visibility matters, not merely an img src attribute.
    cover=Image.new('RGB',(32,32),(190,32,98));buffer=BytesIO();cover.save(buffer,format='PNG')
    artwork='data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode()
    check.evaluate('(v)=>window.__dispatch("media",v)',{**media,'artwork':artwork,'artworkStatus':'ready'})
    check.wait_for_function('() => document.querySelector(".compact-art").classList.contains("has-artwork")')
    assert check.locator('.compact-art img').evaluate('(el)=>el.naturalWidth')==32
    page.locator('.sidebar [data-nav="overview"]').click()
    page.evaluate('(v)=>window.__dispatch("media",v)',{**media,'artwork':artwork,'artworkStatus':'ready'})
    page.wait_for_function('() => document.querySelector(".mini-art").classList.contains("has-artwork")')
    assert page.locator('.mini-art img').evaluate('(el)=>el.naturalWidth')==32
    page.locator('.sidebar [data-nav="music"]').click()
    page.wait_for_function('() => document.querySelector(".album-art").classList.contains("has-artwork")')
    assert page.locator('.album-art img').evaluate('(el)=>Number(getComputedStyle(el).opacity)')>=0
    page.evaluate('(v)=>window.__dispatch("media",v)',{**media,'trackKey':'next-fixture','title':'Следующий сразу','artwork':None,'artworkStatus':'loading'})
    assert page.locator('[data-track-title]').first.inner_text()=='Следующий сразу'
    assert page.locator('.album-art img').count()==0
    assert page.locator('.album-art .track-monogram').count()==0
    assert page.locator('.album-art .icon').count()==1
    page.evaluate('(v)=>window.__dispatch("media",v)',{'trackKey':'next-fixture','artwork':artwork,'artworkStatus':'ready'})
    page.wait_for_function('() => document.querySelector(".album-art").classList.contains("has-artwork")')
    page.wait_for_timeout(250)
    assert page.locator('.album-art img').evaluate('(el)=>Number(getComputedStyle(el).opacity)')==1
    page.screenshot(path=OUT/'music-cover.png')
    # A white desktop plus minimum opacity must not wash out settings or menus.
    page.locator('.sidebar [data-nav="overview"]').click()
    page.add_style_tag(content='html{background:white!important}')
    for mode in ['modern','liquid','frosted']:
        page.evaluate('(v)=>window.__dispatch("settings",v)',{**settings,'uiRenderer':mode,'islandRenderer':'liquid','opacity':35})
        page.wait_for_timeout(150)
        shot=Image.open(BytesIO(page.screenshot())).convert('RGB')
        assert max(shot.getpixel((1170,800)))<85, (mode,shot.getpixel((1170,800)))
        assert page.locator('.app-shell').evaluate('(el)=>getComputedStyle(el).backdropFilter')=='none'
        assert page.locator('.sidebar').evaluate('(el)=>getComputedStyle(el).backdropFilter')=='none'
        page.locator('[data-setting="autoLaunch"]').locator('..').locator('button').click()
        assert page.locator('.floating-menu').get_attribute('data-renderer')==mode
        assert page.locator('.floating-menu').evaluate('(el)=>getComputedStyle(el).backdropFilter')=='none'
        page.wait_for_timeout(220)
        panel=page.locator('.floating-menu').bounding_box()
        assert panel['x']>=12 and panel['x']+panel['width']<=1180
        page.screenshot(path=OUT/f'menu-{mode}-white-desktop.png')
        page.keyboard.press('Escape')
    page.locator('.sidebar [data-nav="appearance"]').click()
    page.evaluate('(v)=>window.__dispatch("settings",v)',{**settings,'uiRenderer':'liquid','islandRenderer':'liquid','opacity':35})
    page.locator('[data-setting="uiRenderer"]').locator('..').locator('button').click()
    page.wait_for_timeout(250)
    page.screenshot(path=OUT/'settings-glass-readable.png')
    page.keyboard.press('Escape')
    assert not errors, errors
    print(json.dumps(dict(overlay_style_combinations=9, alpha_samples=alphas, expanded_width=446, scale_dpr_material_checks=scale_checks, custom_popovers=True, decoded_cover=True, readable_white_desktop=True, transparent_margins=True, errors=errors), ensure_ascii=False))
    browser.close()
