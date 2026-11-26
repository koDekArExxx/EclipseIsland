"""Optional Chromium check for the theme studio (build:preview first)."""
from pathlib import Path
import os, json
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.environ.get('ECLIPSE_CHECK_BROWSER'),args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1150,'height':850})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    def load(page,storage):
        # In restricted Chromium environments, use an in-memory storage fixture.
        stub='<script>window.themeStorage='+json.dumps(storage)+';Object.defineProperty(window,"localStorage",{value:{getItem:k=>window.themeStorage[k]??null,setItem:(k,v)=>window.themeStorage[k]=String(v)}});</script>'
        page.set_content((root/'EclipseIsland-preview.html').read_text().replace('<head>','<head>'+stub,1))
    load(page,{})
    page.wait_for_selector('.sidebar')
    page.locator('.sidebar [data-nav="appearance"]').click()
    page.wait_for_selector('.theme-presets')
    assert page.locator('.advanced-theme-panel').is_hidden()
    def pref(key):return page.evaluate('(k)=>JSON.parse(localStorage.getItem("island-settings"))[k]',key)
    def css(sel,prop):return page.locator(sel).evaluate('(e,p)=>getComputedStyle(e).getPropertyValue(p).trim()',prop)
    def change(key,val):
        page.locator('[data-setting="'+key+'"]').evaluate('(el,v)=>{el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));}',str(val))
        page.wait_for_timeout(50)
    for theme in ['graphite','midnight','amethyst','emerald','sunset','rose','oled','arctic']:
        el=page.locator('[data-color-theme="'+theme+'"]');el.click();page.wait_for_timeout(65)
        assert el.get_attribute('aria-pressed')=='true',theme
        assert pref('advancedTheme') is True
        assert css('.island','--surface')==pref('islandSurface')
        assert css('.sidebar','background-color')==page.evaluate('(c)=>{const e=document.createElement("div");e.style.color=c;document.body.append(e);const v=getComputedStyle(e).color;e.remove();return v}',pref('sidebarColor'))
    assert page.locator('.advanced-theme-panel').is_visible()
    # Reproduce the reported mismatch: emerald preset, then purple swatch.
    page.locator('[data-color-theme="emerald"]').click()
    assert css('.island','--accent')=='#81e6b5'
    for key,value in [('violet','#bda2ff'),('mint','#bcebc5'),('blue','#b3d6ff'),('peach','#f2ccb2'),('rose','#f5a1ca'),('amber','#efcb7b')]:
        page.locator('.swatches [data-accent="'+key+'"]').click()
        page.wait_for_timeout(50)
        assert css('.island','--accent')==value,(key,css('.island','--accent'))
        assert pref('islandAccent')==value
        assert pref('separateIslandAccent') is False
    page.locator('[data-inline-hex="islandAccent"]').fill('#123abc')
    page.locator('[data-inline-hex="islandAccent"]').press('Tab')
    page.wait_for_timeout(70)
    assert pref('separateIslandAccent') is True
    assert css('.island','--accent')=='#123abc'
    page.locator('.swatches [data-accent="violet"]').click()
    assert css('.island','--accent')=='#bda2ff'

    # HEX editing changes the actual island, not the surrounding UI.
    hex_input=page.locator('[data-inline-hex="islandSurface"]');hex_input.fill('#123456');hex_input.press('Tab');page.wait_for_timeout(70)
    assert pref('islandSurface')=='#123456';assert css('.island','--surface')=='#123456';assert css('.app-shell','--surface')!= '#123456'
    change('borderWidth',3);assert css('.island','border-top-width')=='3px'
    change('borderOpacity',70);assert css('.island','border-top-color')!='rgba(0, 0, 0, 0)'
    change('compactRadius',16);page.wait_for_timeout(420);assert css('.island','border-top-left-radius')=='16px'
    change('islandOpacity',45);assert css('.island','--theme-island-opacity')=='0.45'
    change('gradientAngle',90);assert '90deg' in css('.island','background-image')
    page.locator('[data-setting="gradientEnabled"]').uncheck();assert pref('gradientEnabled') is False
    for mode in ['modern','liquid','frosted']:
        page.locator('[data-renderer-preset="'+mode+'"]').click();page.wait_for_timeout(60)
        assert css('.island','--surface')=='#123456'
        assert css('.island','border-top-width')=='3px'
    page.locator('[data-setting="hoverExpand"]').uncheck();page.locator('[data-expand]').click();page.wait_for_timeout(480)
    for tab in ['today','music','weather','capture','launcher','screenshots']:
        page.locator('[data-island-tab="'+tab+'"]').click();page.wait_for_timeout(430)
        shell=page.locator('.island').bounding_box();footer=page.locator('.island-bottom').bounding_box()
        assert footer['y']+footer['height']<=shell['y']+shell['height'],tab
    storage=page.evaluate('window.themeStorage');page.close();page=browser.new_page(viewport={'width':1150,'height':850});page.on('pageerror',lambda e:errors.append(str(e)));load(page,storage);page.wait_for_selector('.sidebar');page.locator('.sidebar [data-nav="appearance"]').click()
    assert css('.island','--surface')=='#123456';assert pref('borderWidth')==3
    page.locator('[data-setting="advancedTheme"]').uncheck();assert page.locator('.advanced-theme-panel').is_hidden();assert css('.island','--surface')!= '#123456'
    page.locator('[data-setting="advancedTheme"]').check();assert css('.island','--surface')=='#123456'
    page.locator('[data-reset-theme]').click();page.wait_for_timeout(60);assert pref('advancedTheme') is False;assert pref('accent')=='violet';assert pref('borderWidth')==1
    assert not errors,errors
    print('8 palettes, live independent HEX, sliders, 3 materials, 6 tab footers, persistence, toggle and reset passed')
    browser.close()
