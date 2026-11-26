"""Optional Chromium adaptive centered layout check; run with playwright installed."""
from pathlib import Path
import json, subprocess, re, os
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
src=root/'src'
settings=json.loads(subprocess.check_output(['node','-p','JSON.stringify(require("./electron/settings.cjs").defaults)'],cwd=root))
settings.update(sounds=False,hoverExpand=False,reducedMotion=True)
initial=dict(settings=settings,weather={'status':'empty'},media={'available':True,'active':True,'title':'Test','artist':'Test','position':0,'duration':90},platform='win32',monitors=[],shortcuts={},tools={'entries':[{'id':str(i),'name':f'App {i}','target':f'C:/App{i}.exe','kind':'app'} for i in range(24)],'recent':[{'id':str(i),'createdAt':1700000000000,'width':815,'height':558,'format':'png'} for i in range(3)],'settings':{}},capture={'status':'idle','settings':{},'recent':[]})
js='\n'.join(re.sub(r'^export ', '', re.sub(r'^import .*;\s*$', '',(src/name).read_text(),flags=re.M),flags=re.M)+('\nconst esc=escapeHTML;const escape=escapeHTML;' if name=='model.js' else '') for name in ['icons.js','model.js','browser-api.js','audio.js','controls.js','app.js'])
fixture='''const fixture=INITIAL;let listener;window.saved=[];window.island={init:async()=>fixture,on:fn=>listener=fn,save:async value=>{fixture.settings=value;window.saved.push(value);return value},bounds:()=>{},media:async()=>({ok:true}),showSettings:()=>{},captureSources:async()=>[]};window.dispatchState=(type,value)=>{fixture[type]=value;listener({type,value})};window.dispatchSettings=value=>{fixture.settings={...fixture.settings,...value};listener({type:'settings',value:fixture.settings})};'''.replace('INITIAL',json.dumps(initial))
css=(src/'styles.css').read_text()+'\n'+(src/'overlay.css').read_text()
with sync_playwright() as p:
    executable=os.environ.get('ECLIPSE_CHECK_BROWSER')
    browser=p.chromium.launch(headless=True,executable_path=executable,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':600,'height':760})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<html class="overlay-document"><head><style>'+css+'</style></head><body class="overlay-mode"><div id="app"></div><div id="toast"></div></body></html>')
    page.add_script_tag(content=fixture+'\n'+js)
    page.wait_for_selector('.island')
    def settings_patch(patch):
        page.evaluate('(p)=>window.dispatchSettings(p)',patch);page.wait_for_timeout(60)
    def check_box():
        island,footer=page.evaluate('''()=>['.island','.island-bottom'].map(sel=>{const {x,y,width,height}=document.querySelector(sel).getBoundingClientRect();return {x,y,width,height}})''')
        assert island['y']+island['height']<=page.viewport_size['height']-3, island
        assert footer['y']+footer['height']<=island['y']+island['height']-2,(island,footer)
        assert footer['y']>=island['y'],(island,footer)
        return island
    page.locator('[data-expand]').click()
    for scale in [80,100,120]:
        settings_patch({'scale':scale})
        heights=[]
        for tab in ['today','music','weather','capture','launcher','screenshots']:
            page.locator('[data-island-tab="'+tab+'"]').click();page.wait_for_timeout(35)
            b=check_box();heights.append(b['height'])
            assert abs(b['x']+b['width']/2-300)<1,b
        assert max(heights)-min(heights)>40,heights
        print(scale,heights)
    settings_patch({'scale':100})
    # Natural height must follow asynchronous content changes, even on the same tab.
    page.locator('[data-island-tab="screenshots"]').click();page.wait_for_timeout(60)
    original=check_box()['height']
    page.evaluate('(tools)=>window.dispatchState("tools",tools)',{**initial['tools'],'recent':[]});page.wait_for_timeout(100)
    assert check_box()['height']<original-30
    page.evaluate('(tools)=>window.dispatchState("tools",tools)',initial['tools']);page.wait_for_timeout(100)
    assert abs(check_box()['height']-original)<2
    # Real animation must pass intermediate heights with a fixed top edge and visible footer.
    page.locator('[data-island-tab="today"]').click();page.wait_for_timeout(80)
    short=check_box();settings_patch({'reducedMotion':False})
    page.locator('[data-island-tab="launcher"]').click();page.wait_for_timeout(45)
    middle=check_box();page.wait_for_timeout(500);tall=check_box()
    assert short['height']<middle['height']<tall['height'],(short,middle,tall)
    assert abs(short['y']-tall['y'])<1
    page.locator('[data-island-tab="today"]').click();page.wait_for_timeout(45)
    middle=check_box();page.wait_for_timeout(500);end=check_box()
    assert end['height']<middle['height']<tall['height'],(end,middle,tall)
    assert abs(end['height']-short['height'])<2
    settings_patch({'reducedMotion':True})
    # Horizontal drags must not change geometry or save position settings.
    for dx in [-110,110]:
        b=page.locator('[data-expand]').bounding_box();x=b['x']+b['width']/2;y=b['y']+b['height']/2
        page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+dx,y,steps=5);page.mouse.up();page.wait_for_timeout(80)
        b=page.locator('.island').bounding_box()
        assert abs(b['x']+b['width']/2-300)<1,b
        assert page.evaluate('window.saved.length')==0
    if not page.locator('.island.expanded').count():page.locator('[data-expand]').click()
    page.locator('[data-island-tab="screenshots"]').click()
    page.set_viewport_size({'width':600,'height':310});settings_patch({'scale':120})
    check_box();assert page.locator('.island-panel').evaluate('(el)=>el.scrollHeight>el.clientHeight')
    assert not errors,errors
    print('18 adaptive layout cases, live updates, animation in both directions, two non-moving drags, and small-height scroll passed')
    browser.close()
