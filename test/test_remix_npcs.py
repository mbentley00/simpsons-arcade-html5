"""NPC authoring/talking and the real transition-to-upgrade UI, using the player's local ROM."""
import functools,http.server,json,os,threading
from playwright.sync_api import sync_playwright
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=os.path.join(ROOT,'web')))
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
    with sync_playwright() as p:
        browser=p.chromium.launch();ctx=browser.new_context(viewport={'width':1400,'height':1000});editor=ctx.new_page();errors=[]
        editor.on('pageerror',lambda e:errors.append(str(e)))
        editor.goto(f'http://127.0.0.1:{server.server_port}/editor.html');editor.locator('#romload input[type=file]').set_input_files(os.path.join(ROOT,'roms/simpsons.zip'))
        editor.wait_for_function('document.getElementById("scene").options.length===12')
        editor.select_option('#scene',label='Stage 5 - gorge');editor.click('#toolNpcs');editor.select_option('#enemyKind','slugger')
        box=editor.locator('#map').bounding_box();zoom=editor.evaluate('document.getElementById("map").getBoundingClientRect().width/document.getElementById("map").width')
        editor.mouse.click(box['x']+220*zoom,box['y']+192*zoom)
        editor.fill('#npcName','Coach');editor.fill('#npcDialogue','Up plus attack launches. Keep your combo going!');editor.click('#npcApply')
        editor.wait_for_timeout(300)
        saved=editor.evaluate('JSON.parse(localStorage.getItem(SIMPSTAGE.PATCH_KEY))')
        npc=next(r for r in saved['enemies']['6'] if r.get('role')=='npc');assert npc['skin']=='slugger' and npc['npcName']=='Coach'
        with editor.expect_download() as download:editor.click('#exp')
        assert json.load(open(download.value.path()))['enemies']['6'][-1]['dialogue']==npc['dialogue']
        editor.reload();editor.wait_for_function('document.getElementById("scene").options.length===12');editor.click('#toolNpcs');assert 'Coach' in editor.locator('#enemyList').inner_text()
        with ctx.expect_page() as pop:editor.click('#play')
        game=pop.value;game.on('pageerror',lambda e:errors.append(str(e)));game.wait_for_url('**/index.html?scene=9&play=1');game.evaluate('SIMPG.ready')
        game.evaluate('SIMPG.pause(true)')
        assert game.evaluate('SIMPG.machine.stageNPCs[6][0].npcName')=='Coach'
        assert game.evaluate('Object.keys(SIMPG.machine.stageEnemySkins).length')==0,'NPC must not allocate an enemy actor'
        assert game.evaluate('SIMPCOMBAT.enabled && !!SIMPG.machine.arcadeCombat')
        # Move the player beside the NPC through the native position fields to test the interaction deterministically.
        game.evaluate('''() => { const m=SIMPG.machine,n=SIMPENEMY.npcPositions(m)[0],x=n.x+54,y=374-n.feet; m.ram[0xa4c]=x>>8;m.ram[0xa4d]=x&255;m.ram[0xa51]=y>>8;m.ram[0xa52]=y&255;m.ram[0xa57]=0;SIMPG.pause(false); }''')
        game.wait_for_function('!document.getElementById("npc-prompt").hidden')
        game.keyboard.press('e');game.wait_for_selector('#npc-dialog',state='visible');assert game.locator('#npc-name').inner_text()=='Coach';assert game.locator('#npc-text').inner_text()==npc['dialogue']
        os.makedirs(os.path.join(ROOT,'preview'),exist_ok=True);game.screenshot(path=os.path.join(ROOT,'preview/npc_dialogue.png'))
        assert game.evaluate('SIMPG.paused');game.keyboard.press('Escape');assert not game.locator('#npc-dialog').is_visible()
        print('ok NPC placement/name/dialogue, export/reload, no enemy allocation, proximity interaction and pause/resume')
        # B throws a free bowling ball: plain board data, drawn into the game picture where it rolls.
        game.evaluate('SIMPG.machine.arcadeCombat.players[0].dir=-1;SIMPG.pause(false)');game.keyboard.press('b');game.wait_for_function('SIMPG.machine.arcadeCombat.balls.length>0',timeout=3000)
        game.wait_for_timeout(60);game.evaluate('SIMPG.pause(true)')
        ball=game.evaluate('(()=>{const m=SIMPG.machine,b=m.arcadeCombat.balls[0],cam=((m.ram[0x8ac]<<8)|m.ram[0x8ad])<<16>>16;return b&&{x:Math.round(b.x-cam-54),y:374-b.z-7,f:m.frame-b.born};})()')
        assert ball, 'ball still rolling'
        drawn=game.evaluate('''(b)=>{const a=SIMPG.pixels(),c=SIMPG.screenPixels();let n=0;for(let y=b.y-9;y<=b.y+9;y++)for(let x=b.x-9;x<=b.x+9;x++){if(x<0||x>=320||y<0||y>=224)continue;const i=y*320+x;if(a[i]!==c[i])n++;}return n;}''',ball)
        assert drawn>40,f'ball pixels drawn in the overlay ({drawn})'
        game.screenshot(path=os.path.join(ROOT,'preview/bowling_ball.png'))
        print(f'ok B bowls a free ball that rolls inside the game picture ({drawn} px)')
        # Exercise exactly the native scene-write hook used at stage completion.
        # A strong stage (S rank) shows the results card and a bonus fourth card, with at least one rare/epic.
        game.evaluate('''() => {const m=SIMPG.machine,s=m.arcadeCombat;Object.assign(s.stage,{start:m.frame-6000,best:12,kos:20,elites:2,counters:3,taken:0});m.mw(0x4803,10);m.ram[0x804]=0;SIMPCOMBAT.afterFrame(m);}''')
        # The draft is drawn inside the game picture (no HTML panels) and holds the board while it is open.
        game.wait_for_function('SIMPCOMBAT.drafting && SIMPCOMBAT.cards.length===4')
        assert game.evaluate('SIMPCOMBAT.blocked && SSRIN.block')
        assert game.evaluate("['#upgrade-draft','#combat-hud','#combat-callout'].every(q=>!document.querySelector(q))"),'remix UI must not be page panels'
        res=game.evaluate('SIMPG.machine.arcadeCombat.results');assert res['rank']=='S' and res['best']==12
        offers=game.evaluate('SIMPG.machine.arcadeCombat.offers');assert len(offers)==4
        assert any(game.evaluate('(id)=>SIMPCOMBAT.UPGRADES.find(u=>u.id===id).rarity',o)!='common' for o in offers)
        changed=game.evaluate('(()=>{const a=SIMPG.pixels(),b=SIMPG.screenPixels();let n=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])n++;return n;})()')
        assert changed>320*224*0.8,f'draft overlay drawn into the frame ({changed} px)'
        assert 'keys 1 to 4' in game.locator('#combat-live').text_content()
        game.screenshot(path=os.path.join(ROOT,'preview/upgrade_draft.png'))
        game.keyboard.press('ArrowRight');assert game.evaluate('SIMPCOMBAT.selected')==1
        game.keyboard.press('ArrowLeft');game.keyboard.press('ArrowLeft');assert game.evaluate('SIMPCOMBAT.selected')==3
        assert not game.locator('#chatin').is_visible()
        # mouse: click the third card through the canvas mapping
        card=game.evaluate('SIMPCOMBAT.cards[2]');scr=game.locator('#screen').bounding_box()
        game.mouse.click(scr['x']+(card['x']+card['w']/2)*scr['width']/320,scr['y']+(card['y']+card['h']/2)*scr['height']/224)
        assert game.evaluate('(id)=>SIMPG.machine.arcadeCombat.upgrades[id]',offers[2])==1
        assert not game.evaluate('SIMPCOMBAT.drafting');game.wait_for_function('!SIMPCOMBAT.blocked')
        print('ok in-game results card with S rank, fourth bonus card, rarity, keyboard selection and canvas click')
        # a later stage clear: digit keys pick directly
        game.evaluate('''() => {const m=SIMPG.machine;m.ram[0x803]=11;m.mw(0x4803,12);SIMPCOMBAT.afterFrame(m);}''')
        game.wait_for_function('SIMPCOMBAT.drafting && SIMPCOMBAT.cards.length>=3')
        offers=game.evaluate('SIMPG.machine.arcadeCombat.offers');game.keyboard.press('2')
        assert game.evaluate('(id)=>SIMPG.machine.arcadeCombat.upgrades[id]',offers[1])>=1;assert not game.evaluate('SIMPCOMBAT.drafting')
        # how-to-play page inside the game: H opens (holds the game), Escape closes
        game.evaluate('SIMPG.machine.ram[0x803]=9')
        game.wait_for_function('!SIMPCOMBAT.blocked');game.evaluate('SIMPG.pause(true)');game.evaluate('[SIMPG.machine.ram[0x800],SIMPG.machine.ram[0x802]]=[2,1]');game.keyboard.press('h');game.wait_for_function('SIMPCOMBAT.helpOpen && SIMPCOMBAT.blocked',timeout=3000)
        game.screenshot(path=os.path.join(ROOT,'preview/remix_help_page.png'))
        game.keyboard.press('Escape');assert not game.evaluate('SIMPCOMBAT.helpOpen')
        print('ok second draft picks with digit keys; in-game how-to-play page opens and closes')
        game.evaluate('SIMPG.pause(true)');assert not errors,errors
        print('ok stage-clear draft holds play and applies the selected persistent run upgrade; no page errors')
        os.makedirs(os.path.join(ROOT,'preview'),exist_ok=True);game.screenshot(path=os.path.join(ROOT,'preview/npc_remix.png'))
        browser.close()
finally:server.shutdown()
