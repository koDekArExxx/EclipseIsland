#!/usr/bin/env python3
"""EclipseIsland distribution bot. Python 3.11+, standard library only."""
import hashlib, html, io, json, logging, os, re, secrets, sqlite3, sys, threading, time
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

LOG=logging.getLogger('eclipse-bot')
ADMIN_DEFAULT=1375098087
VERSION=re.compile(r'^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$')
def version_key(value):
    if not isinstance(value,str) or not VERSION.fullmatch(value): raise ValueError('Версия должна иметь вид 0.9.1')
    return tuple(map(int,value.split('.')))
def is_member(member):
    return member.get('status') in ('creator','administrator','member') or (member.get('status')=='restricted' and member.get('is_member') is True)
def esc(value): return html.escape(str(value))
def excerpt(value,maximum=2600):
    result=[];size=0
    for char in str(value):
        part=esc(char)
        if size+len(part)>maximum:return ''.join(result)+'…'
        result.append(part);size+=len(part)
    return ''.join(result)
class ServiceError(Exception): pass
class Config:
    def __init__(self,env=os.environ):
        self.token=env.get('BOT_TOKEN','').strip();self.repo=env.get('GITHUB_REPO','').strip()
        self.github_token=env.get('GITHUB_TOKEN','').strip();self.admin=int(env.get('ADMIN_ID',str(ADMIN_DEFAULT)))
        self.channel=env.get('CHANNEL_ID','@EclipseIsland').strip();self.channel_url=env.get('CHANNEL_URL','https://t.me/EclipseIsland')
        self.ref=env.get('GITHUB_REF','main');self.workflow='release.yml';self.data=Path(env.get('DATA_DIR',str(Path(__file__).parent/'data')))
        if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',self.repo):raise ValueError('Задайте GITHUB_REPO=LOGIN/EclipseIsland')
        if not re.fullmatch(r'\d+:[A-Za-z0-9_-]+',self.token):raise ValueError('Задайте BOT_TOKEN в окружении')
        if not self.channel_url.startswith('https://t.me/'):raise ValueError('CHANNEL_URL должен вести на t.me')
class Store:
    def __init__(self,path):
        self.path=path;path.parent.mkdir(parents=True,exist_ok=True)
        with self.connect() as db:db.executescript('''CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY,v TEXT);CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,first_seen REAL,last_seen REAL);CREATE TABLE IF NOT EXISTS wizard(id INTEGER PRIMARY KEY,stage TEXT,version TEXT,notes TEXT,nonce TEXT,expires REAL);CREATE TABLE IF NOT EXISTS jobs(version TEXT PRIMARY KEY,created REAL,status TEXT,run_url TEXT,notified INTEGER DEFAULT 0);''')
    def connect(self):return sqlite3.connect(self.path,timeout=15)
    def get(self,key,default=None):
        with self.connect() as db:r=db.execute('SELECT v FROM kv WHERE k=?',(key,)).fetchone();return json.loads(r[0]) if r else default
    def set(self,key,value):
        with self.connect() as db:db.execute('INSERT OR REPLACE INTO kv VALUES(?,?)',(key,json.dumps(value)))
    def user(self,user):
        with self.connect() as db:db.execute('INSERT INTO users VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen',(user,time.time(),time.time()))
    def wizard(self,user):
        with self.connect() as db:row=db.execute('SELECT stage,version,notes,nonce,expires FROM wizard WHERE id=?',(user,)).fetchone()
        if row and row[4]>time.time():return dict(zip(('stage','version','notes','nonce','expires'),row))
    def draft(self,user,stage,version='',notes='',nonce=''):
        with self.connect() as db:db.execute('INSERT OR REPLACE INTO wizard VALUES(?,?,?,?,?,?)',(user,stage,version,notes,nonce,time.time()+1800))
    def consume(self,user,nonce):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE');row=db.execute('SELECT version,notes FROM wizard WHERE id=? AND nonce=? AND stage=? AND expires>?',(user,nonce,'confirm',time.time())).fetchone()
            if not row:return None
            existing=db.execute('SELECT status FROM jobs WHERE version=?',(row[0],)).fetchone()
            if existing and existing[0]!='failed':return None
            if existing:db.execute('DELETE FROM jobs WHERE version=?',(row[0],))
            db.execute('DELETE FROM wizard WHERE id=?',(user,));db.execute('INSERT INTO jobs(version,created,status,run_url) VALUES(?,?,?,?)',(row[0],time.time(),'dispatching',''));return row
    def job(self,version,status,url=''):
        with self.connect() as db:db.execute('UPDATE jobs SET status=?,run_url=CASE WHEN ?="" THEN run_url ELSE ? END WHERE version=?',(status,url,url,version))
    def jobs(self):
        with self.connect() as db:db.row_factory=sqlite3.Row;return [dict(r) for r in db.execute('SELECT * FROM jobs ORDER BY created DESC LIMIT 20')]
    def notified(self,version):
        with self.connect() as db:db.execute('UPDATE jobs SET notified=1 WHERE version=?',(version,))
    def stats(self):
        with self.connect() as db:return db.execute('SELECT count(*) FROM users').fetchone()[0]
class Telegram:
    def __init__(self,token):self.base='https://api.telegram.org/bot'+token+'/'
    def call(self,method,params=None,file=None):
        params=params or {};headers={}
        if file:
            boundary='Eclipse'+secrets.token_hex(12);body=io.BytesIO()
            for key,value in params.items():
                body.write(('--'+boundary+'\r\nContent-Disposition: form-data; name="'+key+'"\r\n\r\n'+(json.dumps(value,ensure_ascii=False) if isinstance(value,(dict,list)) else str(value))+'\r\n').encode())
            body.write(('--'+boundary+'\r\nContent-Disposition: form-data; name="document"; filename="EclipseIsland-Setup.exe"\r\nContent-Type: application/octet-stream\r\n\r\n').encode());body.write(file);body.write(('\r\n--'+boundary+'--\r\n').encode());data=body.getvalue();headers['Content-Type']='multipart/form-data; boundary='+boundary
        else:data=json.dumps(params).encode();headers['Content-Type']='application/json'
        try:
            with urlopen(Request(self.base+method,data=data,headers=headers),timeout=40) as response:result=json.load(response)
            if not result.get('ok'):raise ServiceError('Telegram не выполнил '+method)
            return result['result']
        except (HTTPError,URLError,TimeoutError):raise ServiceError('Telegram временно недоступен') from None
class GitHub:
    def __init__(self,config):self.c=config;self.cached=None;self.cached_at=0;self.lock=threading.Lock()
    def call(self,path,body=None,missing=False):
        headers={'Accept':'application/vnd.github+json','User-Agent':'EclipseIsland-ReleaseBot','X-GitHub-Api-Version':'2022-11-28'}
        if self.c.github_token:headers['Authorization']='Bearer '+self.c.github_token
        try:
            request=Request('https://api.github.com/repos/'+self.c.repo+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
            with urlopen(request,timeout=25) as response:data=response.read(3*1024*1024);return json.loads(data) if data else {}
        except HTTPError as error:
            if error.code==404 and missing:return None
            raise ServiceError('GitHub: HTTP '+str(error.code)) from None
        except (URLError,TimeoutError):raise ServiceError('GitHub временно недоступен') from None
    def latest(self,force=False):
        with self.lock:
            if not force and self.cached is not None and time.time()-self.cached_at<120:return self.cached
            self.cached=self.call('/releases/latest',missing=True);self.cached_at=time.time();return self.cached
    def dispatch(self,version,notes):
        if not self.c.github_token:raise ServiceError('На хосте не настроен GITHUB_TOKEN')
        return self.call('/actions/workflows/'+self.c.workflow+'/dispatches',{'ref':self.c.ref,'inputs':{'version':version,'notes':notes}})
    def release(self,version):return self.call('/releases/tags/v'+version,missing=True)
    def runs(self):return self.call('/actions/workflows/'+self.c.workflow+'/runs?event=workflow_dispatch&per_page=30').get('workflow_runs',[])
    def setup(self):
        release=self.latest();
        if not release:raise ServiceError('Первый выпуск ещё не опубликован')
        assets={a['name']:a for a in release.get('assets',[])};asset=assets.get('EclipseIsland-Setup.exe')
        if not asset:raise ServiceError('В выпуске нет EclipseIsland-Setup.exe')
        if not (0<asset.get('size',0)<20*1024*1024):raise ServiceError('Некорректный размер установщика')
        cache=self.c.data/'setup-cache';cache.mkdir(exist_ok=True);file=cache/(str(asset['id'])+'.exe')
        digest=asset.get('digest','');expected=digest.split(':',1)[1] if digest.startswith('sha256:') else None
        if file.exists() and file.stat().st_size==asset['size'] and (not expected or hashlib.sha256(file.read_bytes()).hexdigest()==expected):return file.read_bytes(),release
        url=asset.get('browser_download_url','');prefix='https://github.com/'+self.c.repo+'/releases/download/'
        if not url.startswith(prefix):raise ServiceError('Установщик находится вне репозитория')
        try:
            with urlopen(Request(url,headers={'User-Agent':'EclipseIsland-ReleaseBot'}),timeout=60) as response:data=response.read(20*1024*1024+1)
        except (HTTPError,URLError,TimeoutError):raise ServiceError('Не удалось получить установщик') from None
        if len(data)!=asset['size'] or (expected and hashlib.sha256(data).hexdigest()!=expected):raise ServiceError('Установщик загружен не полностью или повреждён')
        temp=file.with_suffix('.part');temp.write_bytes(data);temp.replace(file)
        for old in cache.glob('*.exe'):
            if old!=file:old.unlink(missing_ok=True)
        return data,release
class Bot:
    def __init__(self,c,tg=None,github=None,store=None):self.c=c;self.tg=tg or Telegram(c.token);self.gh=github or GitHub(c);self.db=store or Store(c.data/'bot.sqlite');self.stop=threading.Event()
    def keyboard(self,user):
        rows=[[{'text':'✨ Получить установщик','callback_data':'download'}],[{'text':'📣 Канал EclipseIsland','url':self.c.channel_url}],[{'text':'🆕 Последняя версия','callback_data':'latest'}]]
        if user==self.c.admin:rows.append([{'text':'⚙️ Админ-панель','callback_data':'admin'}])
        return {'inline_keyboard':rows}
    def send(self,chat,text,keyboard=None):return self.tg.call('sendMessage',{'chat_id':chat,'text':text,'parse_mode':'HTML',**({'reply_markup':keyboard} if keyboard else {})})
    def subscribed(self,user):return is_member(self.tg.call('getChatMember',{'chat_id':self.c.channel,'user_id':user}))
    def gate(self,chat,user):
        try:ok=self.subscribed(user)
        except ServiceError:self.send(chat,'Не удалось проверить подписку. Попробуйте позже. Если ошибка повторяется, администратору нужно проверить права бота в канале.');return False
        if ok:return True
        self.send(chat,'<b>Один шаг до вашего островка</b> 🌙\n\nПодпишитесь на канал EclipseIsland, затем нажмите «Проверить подписку».',{'inline_keyboard':[[{'text':'Подписаться на EclipseIsland','url':self.c.channel_url}],[{'text':'✅ Проверить подписку','callback_data':'download'}]]});return False
    def admin(self,chat,user):
        if user!=self.c.admin:self.send(chat,'Нет доступа.');return
        self.db.draft(user,'none')
        self.send(chat,'<b>EclipseIsland · управление</b>\n\n👥 Пользователей: '+str(self.db.stats())+'\nОбновления собираются из ветки <code>'+esc(self.c.ref)+'</code>.',{'inline_keyboard':[[{'text':'🚀 Выпустить обновление','callback_data':'publish'}],[{'text':'📦 Статус сборок','callback_data':'jobs'},{'text':'🔎 Проверить настройку','callback_data':'health'}],[{'text':'← Главное меню','callback_data':'home'}]]})
    def handle(self,update):
        callback=update.get('callback_query');message=callback.get('message') if callback else update.get('message');user=(callback or update.get('message',{})).get('from',{}).get('id')
        if not message or not user or message.get('chat',{}).get('type')!='private':return
        chat=message['chat']['id'];self.db.user(user)
        if callback:
            try:self.tg.call('answerCallbackQuery',{'callback_query_id':callback['id']})
            except ServiceError:pass
            action=callback.get('data','')
            if action in ('admin','publish','jobs','health') or action.startswith('confirm:'):
                if user!=self.c.admin:self.send(chat,'Нет доступа.');return
            if action=='home':self.welcome(chat,user)
            elif action=='admin':self.admin(chat,user)
            elif action=='download':
                if not self.gate(chat,user):return
                data,release=self.gh.setup();self.tg.call('sendDocument',{'chat_id':chat,'caption':'🌙 EclipseIsland '+release.get('tag_name','')+'\nЗапустите Setup — он скачает приложение и настроит автоматические обновления.\nПеред первой установкой закройте старый островок через трей.'},file=data)
            elif action=='latest':
                release=self.gh.latest();self.send(chat,'<b>Последняя версия</b>\n\n'+(esc(release.get('tag_name',''))+'\n'+excerpt(release.get('body','')) if release else 'Первый выпуск готовится.'),self.keyboard(user))
            elif action=='publish':
                if not self.c.github_token:self.send(chat,'Добавьте GITHUB_TOKEN в окружение хоста. Нужны Actions: read/write и Contents: read для этого репозитория.');return
                self.db.draft(user,'version');self.send(chat,'<b>Новый выпуск</b>\nПришлите номер версии, например <code>0.9.1</code>. Для отмены — /cancel.')
            elif action.startswith('confirm:'):
                row=self.db.consume(user,action.split(':',1)[1]);
                if not row:self.send(chat,'Подтверждение устарело или выпуск уже запущен.');return
                try:self.gh.dispatch(*row);self.db.job(row[0],'queued');self.send(chat,'🚀 Сборка <b>'+esc(row[0])+'</b> запущена. Сообщу результат. Пользователи получат её при следующем запуске после успешной публикации.')
                except ServiceError:self.db.job(row[0],'uncertain');self.send(chat,'Статус запроса не подтверждён. Проверяю GitHub, повторно сборку не отправляю. Откройте «Статус сборок».')
            elif action=='jobs':self.show_jobs(chat)
            elif action=='health':self.health(chat)
            return
        text=message.get('text','').strip()
        if text in ('/start','/help'):self.welcome(chat,user);return
        if text=='/admin':self.admin(chat,user);return
        if user!=self.c.admin:return
        if text=='/cancel':self.db.draft(user,'none');self.admin(chat,user);return
        state=self.db.wizard(user)
        if not state:return
        if state['stage']=='version':
            try:
                key=version_key(text);latest=self.gh.latest(force=True)
                if latest and key<=version_key(latest.get('tag_name','').lstrip('v')):raise ValueError('Укажите версию выше опубликованной')
                if self.gh.release(text):raise ValueError('Такой тег уже существует, в том числе как черновик')
            except ValueError as error:self.send(chat,esc(error));return
            self.db.draft(user,'notes',version=text);self.send(chat,'Теперь пришлите описание изменений. Можно отправить <code>-</code>, чтобы пропустить.');return
        if state['stage']=='notes':
            notes='' if text=='-' else text[:2000];nonce=secrets.token_hex(12);self.db.draft(user,'confirm',state['version'],notes,nonce)
            self.send(chat,'<b>Опубликовать '+esc(state['version'])+'?</b>\n\n'+excerpt(notes or 'Без описания')+'\n\nСборка возьмёт текущие исходники из GitHub. После успеха обновление станет доступно всем установленным загрузчикам.',{'inline_keyboard':[[{'text':'🚀 Выпустить обновление','callback_data':'confirm:'+nonce}],[{'text':'Отмена','callback_data':'admin'}]]})
    def welcome(self,chat,user):
        self.db.draft(user,'none');self.send(chat,'<b>🌙 EclipseIsland</b>\n<i>Всё важное — в вашем островке.</i>\n\nМузыка, записи, снимки и быстрый запуск.\nМаленький установщик скачает нужные файлы, а новые версии установятся перед следующим запуском.',self.keyboard(user))
    def show_jobs(self,chat):
        labels={'dispatching':'отправка запроса','queued':'в очереди','in_progress':'собирается','waiting':'ожидание','uncertain':'проверяем запрос','publishing':'публикуется','published':'опубликован','failed':'ошибка'}
        jobs=self.db.jobs();self.send(chat,'<b>Выпуски</b>\n\n'+('\n'.join(esc(j['version'])+' · '+esc(labels.get(j['status'],j['status']))+(' · <a href="'+esc(j['run_url'])+'">GitHub</a>' if j['run_url'] else '') for j in jobs[:8]) or 'Сборок пока нет.'))
    def health(self,chat):
        me=self.tg.call('getMe');member=self.tg.call('getChatMember',{'chat_id':self.c.channel,'user_id':me['id']});release=self.gh.latest(force=True)
        self.send(chat,'<b>Настройка</b>\n\nБот в канале: '+esc(member.get('status','unknown'))+'\nДля проверки других пользователей нужны права администратора.\nРепозиторий: <code>'+esc(self.c.repo)+'</code>\nПоследний выпуск: '+esc(release.get('tag_name','нет') if release else 'нет')+'\nТокен GitHub: '+('настроен' if self.c.github_token else 'не настроен'))
    def monitor_once(self):
        for job in self.db.jobs():
            if job['status'] in ('published','failed'):
                if not job['notified']:self.send(self.c.admin,('✅ Выпуск опубликован: ' if job['status']=='published' else '❌ Сборка не опубликована: ')+esc(job['version'])+('\n'+esc(job['run_url']) if job['run_url'] else ''));self.db.notified(job['version'])
                continue
            release=self.gh.release(job['version'])
            if release and not release.get('draft') and {'EclipseIsland-Setup.exe','update-manifest.json','EclipseIsland-app.zip'}.issubset({a['name'] for a in release.get('assets',[])}):self.db.job(job['version'],'published',release.get('html_url',''));continue
            if time.time()-job['created']>3600:self.db.job(job['version'],'failed');continue
            runs=self.gh.runs();run=next((r for r in runs if r.get('display_title')=='EclipseIsland v'+job['version'] and datetime.fromisoformat(r['created_at'].replace('Z','+00:00')).timestamp()>=job['created']-5),None)
            if run:
                if run.get('status')=='completed':self.db.job(job['version'],'failed' if run.get('conclusion')!='success' else 'publishing',run.get('html_url',''))
                else:self.db.job(job['version'],run.get('status','queued'),run.get('html_url',''))
            elif time.time()-job['created']>1800:self.db.job(job['version'],'failed')
    def monitor(self):
        while not self.stop.wait(20):
            try:self.monitor_once()
            except Exception as error:LOG.warning('Release monitor: %s',type(error).__name__)
    def run(self):
        if self.tg.call('getWebhookInfo').get('url'):raise ServiceError('Удалите старый webhook перед запуском long polling: python bot.py --clear-webhook')
        self.tg.call('setMyCommands',{'commands':[{'command':'start','description':'Главное меню'},{'command':'admin','description':'Панель администратора'},{'command':'cancel','description':'Отменить ввод'}]})
        threading.Thread(target=self.monitor,daemon=True).start();offset=self.db.get('offset',0)
        while True:
            try:
                updates=self.tg.call('getUpdates',{'offset':offset,'timeout':25,'allowed_updates':['message','callback_query']})
                for update in updates:
                    try:self.handle(update)
                    except ServiceError as error:
                        message=update.get('callback_query',{}).get('message') or update.get('message',{});chat=message.get('chat',{}).get('id')
                        if chat:
                            try:self.send(chat,esc(error))
                            except ServiceError:pass
                    offset=update['update_id']+1;self.db.set('offset',offset)
                (self.c.data/'heartbeat').write_text(str(time.time()))
            except KeyboardInterrupt:self.stop.set();return
            except Exception as error:LOG.warning('Polling: %s',type(error).__name__);time.sleep(5)
def main():
    logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s')
    try:
        c=Config();c.data.mkdir(parents=True,exist_ok=True)
        if '--check-config' in sys.argv:print('Configuration OK');return
        if '--health' in sys.argv:
            if time.time()-float((c.data/'heartbeat').read_text())>180:raise ValueError('Polling heartbeat is old')
            return
        bot=Bot(c)
        if '--clear-webhook' in sys.argv:bot.tg.call('deleteWebhook',{'drop_pending_updates':False});print('Webhook cleared');return
        bot.run()
    except (ValueError,ServiceError) as error:print(str(error),file=sys.stderr);sys.exit(1)
if __name__=='__main__':main()
