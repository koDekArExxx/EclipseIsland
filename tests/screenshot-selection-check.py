"""Chromium smoke check of the area selector with a mocked Electron bridge."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
import json
import os

root = Path(__file__).resolve().parents[1] / 'src'
html=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>', '', (root/'screenshot-select.html').read_text())
html=html.replace('<link rel="stylesheet" href="screenshot-select.css">','<style>'+(root/'screenshot-select.css').read_text()+'</style>').replace('<script type="module" src="screenshot-select.js"></script>','')
js=re.sub(r'^export ', '', (root/'model.js').read_text(), flags=re.M)+'\n'+re.sub(r'^import .*;\s*$', '', (root/'screenshot-select.js').read_text(),flags=re.M)
def load(page,fixture):
    page.set_content(html)
    page.add_script_tag(content=fixture+'\n'+js)
with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox'])
        for viewport in [(1280,720),(480,320)]:
            for mode in ['modern','liquid','frosted']:
                for accent in ['#ffffff','#81e6b5']:
                    page = browser.new_page(viewport={'width':viewport[0],'height':viewport[1]}, device_scale_factor=1.5)
                    theme = {'advancedTheme': True, 'accent':'custom','customAccent':accent,'surfaceColor':'#000000','cardColor':'#101010','textColor':'#f5f5f5','mutedColor':'#aaaaaa','lineColor':'#333333','cardRadius':24,'uiRenderer':mode,'reducedMotion':True}
                    load(page,'window.results=[];window.screenshot={frame:async()=>({image:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC2kAAAAASUVORK5CYII=",pixelWidth:'+str(int(viewport[0]*1.5))+',pixelHeight:'+str(int(viewport[1]*1.5))+',theme:'+json.dumps(theme)+'}),ready:()=>window.isReady=true,finish:v=>{if(document.body.hasPointerCapture(window.lastPointer))throw Error("Pointer still captured at finish");window.results.push(v)}};')
                    page.wait_for_function('window.isReady === true')
                    page.evaluate("document.addEventListener('pointerdown',e=>window.lastPointer=e.pointerId,true)")
                    assert page.locator('html').get_attribute('data-renderer') == mode
                    assert page.locator('#hint').evaluate('(e)=>getComputedStyle(e).borderRadius')=='36px'
                    assert page.locator('html').evaluate('(e)=>e.style.getPropertyValue("--accent")')==accent
                    hint=page.locator('#hint').bounding_box()
                    assert hint['x']>=0 and hint['x']+hint['width']<=viewport[0]
                    # Tiny selection resets, including the help panel.
                    page.mouse.click(10,150)
                    assert page.locator('#selection').is_hidden()
                    assert page.locator('#hint').evaluate('(e)=>getComputedStyle(e).opacity')=='1'
                    # Reverse drag into the edge, with dimensions kept inside the viewport.
                    page.mouse.move(viewport[0]-2,viewport[1]-2);page.mouse.down();page.mouse.move(10,100)
                    assert page.locator('#hint').evaluate('(e)=>getComputedStyle(e).opacity')=='0'
                    label=page.locator('#dimensions').bounding_box()
                    assert label['x']>=0 and label['y']>=0 and label['x']+label['width']<=viewport[0] and label['y']+label['height']<=viewport[1]
                    assert page.locator('#size-value').inner_text()==f'{int((viewport[0]-12)*1.5)} × {int((viewport[1]-102)*1.5)}'
                    page.mouse.up()
                    assert page.evaluate('window.results')==[{'x':10,'y':100,'width':viewport[0]-12,'height':viewport[1]-102}]
                    page.close()
        # Escape and explicit cancellation return null.
        for action in ['escape','button','right']:
            page=browser.new_page();load(page,'window.results=[];window.screenshot={frame:async()=>({image:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC2kAAAAASUVORK5CYII="}),ready:()=>window.isReady=true,finish:v=>{if(document.body.hasPointerCapture(window.lastPointer))throw Error("Pointer still captured at finish");window.results.push(v)}};');page.wait_for_function('window.isReady===true')
            if action=='escape':page.keyboard.press('Escape')
            elif action=='button':page.locator('#cancel').click()
            else:page.mouse.click(10,150,button='right')
            assert page.evaluate('window.results')==[None]
            page.close()
        browser.close()
        print('15 selector checks passed')
