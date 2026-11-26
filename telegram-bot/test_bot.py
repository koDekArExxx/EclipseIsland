import tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
import bot

class BotTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.c=SimpleNamespace(token='test',repo='owner/EclipseIsland',github_token='test',admin=1375098087,channel='@EclipseIsland',channel_url='https://t.me/EclipseIsland',ref='main',data=Path(self.tmp.name))
        self.tg=Mock();self.gh=Mock();self.store=bot.Store(self.c.data/'test.sqlite');self.app=bot.Bot(self.c,self.tg,self.gh,self.store)
        self.gh.latest.return_value={'tag_name':'v0.9.0'};self.gh.release.return_value=None;self.gh.runs.return_value=[]
    def event(self,action=None,text=None,user=None):
        user=self.c.admin if user is None else user
        message={'chat':{'id':user,'type':'private'},'from':{'id':user},'text':text or ''}
        return {'callback_query':{'id':'callback','from':{'id':user},'data':action,'message':message}} if action else {'message':message}
    def test_membership_statuses(self):
        for status in ('creator','administrator','member'):self.assertTrue(bot.is_member({'status':status}))
        for status in ('left','kicked','restricted','unexpected'):self.assertFalse(bot.is_member({'status':status}))
        self.assertTrue(bot.is_member({'status':'restricted','is_member':True}))
    def test_subscription_checked_each_download_and_failure_closed(self):
        self.tg.call.return_value={'status':'left'};self.app.handle(self.event(action='download',user=12));self.gh.setup.assert_not_called()
        self.tg.call.return_value={'status':'member'};self.gh.setup.return_value=(b'exe',{'tag_name':'v0.9.0'})
        self.app.handle(self.event(action='download',user=12));self.gh.setup.assert_called_once()
        self.tg.call.return_value={'status':'left'};self.app.handle(self.event(action='download',user=12));self.assertEqual(self.gh.setup.call_count,1)
        self.tg.call.side_effect=lambda method,*args,**kw: (_ for _ in ()).throw(bot.ServiceError('offline')) if method=='getChatMember' else {}
        self.app.handle(self.event(action='download',user=12));self.assertEqual(self.gh.setup.call_count,1)
    def test_forged_admin_callbacks_are_rejected(self):
        for action in ('admin','publish','jobs','health','confirm:forged'):self.app.handle(self.event(action=action,user=12))
        self.gh.dispatch.assert_not_called();self.assertEqual(self.store.jobs(),[]);self.assertIsNone(self.store.wizard(12))
    def wizard(self):
        self.app.handle(self.event(action='publish'));self.app.handle(self.event(text='0.9.1'));self.app.handle(self.event(text='<new features>'))
        return self.store.wizard(self.c.admin)['nonce']
    def test_release_confirmation_exactly_once_and_escaped(self):
        nonce=self.wizard();self.app.handle(self.event(action='confirm:'+nonce));self.app.handle(self.event(action='confirm:'+nonce))
        self.gh.dispatch.assert_called_once_with('0.9.1','<new features>');self.assertEqual(self.store.jobs()[0]['status'],'queued')
        texts=[call.args[1].get('text','') for call in self.tg.call.call_args_list if call.args[0]=='sendMessage'];self.assertTrue(any('&lt;new features&gt;' in t for t in texts))
    def test_cancel_invalidates_old_confirmation(self):
        nonce=self.wizard();self.app.handle(self.event(action='admin'));self.app.handle(self.event(action='confirm:'+nonce));self.gh.dispatch.assert_not_called()
    def test_uncertain_dispatch_is_not_retried(self):
        nonce=self.wizard();self.gh.dispatch.side_effect=bot.ServiceError('timeout')
        self.app.handle(self.event(action='confirm:'+nonce));self.app.handle(self.event(action='confirm:'+nonce))
        self.gh.dispatch.assert_called_once();self.assertEqual(self.store.jobs()[0]['status'],'uncertain')
    def test_monitor_requires_complete_published_release(self):
        nonce=self.wizard();self.store.consume(self.c.admin,nonce)
        self.gh.release.return_value={'draft':False,'html_url':'https://github.com/owner/EclipseIsland/releases/tag/v0.9.1','assets':[{'name':n} for n in ('EclipseIsland-Setup.exe','EclipseIsland-app.zip')]}
        self.app.monitor_once();self.assertNotEqual(self.store.jobs()[0]['status'],'published')
        self.gh.release.return_value['assets'].append({'name':'update-manifest.json'});self.app.monitor_once();self.assertEqual(self.store.jobs()[0]['status'],'published')
        self.app.monitor_once();self.assertEqual(self.store.jobs()[0]['notified'],1)
    def test_version_validation(self):
        for value in ('0.9','v0.9.1','01.2.3','../../x','1.2.3;command','1.2.3\n','1.100000.3'):
            with self.assertRaises(ValueError):bot.version_key(value)
        self.assertGreater(bot.version_key('0.10.0'),bot.version_key('0.9.9'))
    def test_older_version_and_existing_draft_rejected(self):
        self.app.handle(self.event(action='publish'));self.app.handle(self.event(text='0.9.0'));self.assertEqual(self.store.wizard(self.c.admin)['stage'],'version')
        self.gh.release.return_value={'draft':True};self.app.handle(self.event(text='0.9.1'));self.assertEqual(self.store.wizard(self.c.admin)['stage'],'version')
    def test_configuration_has_no_embedded_secrets(self):
        with self.assertRaises(ValueError):bot.Config({})
        c=bot.Config({'BOT_TOKEN':'123:placeholder','GITHUB_REPO':'owner/EclipseIsland'});self.assertEqual(c.admin,1375098087);self.assertEqual(c.channel,'@EclipseIsland')
    def test_excerpt_does_not_split_html_entities(self):
        self.assertEqual(bot.excerpt('&'*1000,10),'&amp;&amp;…')

if __name__=='__main__':unittest.main()
