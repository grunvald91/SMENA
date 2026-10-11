"""Local rehearsal only. Does not validate the Telegram SDK migration generator."""
import json, sqlite3, sys, tempfile
from pathlib import Path
old, new = json.load(sys.stdin)
def column(c, additive=False):
    s = '"'+c['name']+'" '+c['type']
    if c.get('pk'): s += ' PRIMARY KEY' + (' AUTOINCREMENT' if c.get('auto') else '')
    if c.get('required'): s += ' NOT NULL'
    if c.get('distinct') and not additive: s += ' UNIQUE'
    if 'value' in c: s += ' DEFAULT '+("'"+c['value'].replace("'", "''")+"'" if isinstance(c['value'], str) else str(c['value']))
    return s
def create(db,t):
    db.execute('CREATE TABLE "'+t['name']+'" ('+', '.join(column(c) for c in t['columns'])+')')
    for i in t['indexes']:
        db.execute('CREATE '+('UNIQUE ' if i['unique'] else '')+'INDEX "'+i['name']+'" ON "'+t['name']+'" ('+','.join('"'+c+'"' for c in i['cols'])+')'+(' WHERE '+i['condition'] if 'condition' in i else ''))
def insert(db,t,values):
    db.execute('INSERT INTO '+t+' ('+','.join(values)+') VALUES ('+','.join('?' for _ in values)+')',tuple(values.values()))
def rejects(fn):
    try: fn()
    except sqlite3.IntegrityError: return
    raise AssertionError('Unique constraint not enforced')
with tempfile.TemporaryDirectory() as temp:
    path=Path(temp)
    db=sqlite3.connect(path/'before.db')
    for t in old: create(db,t)
    insert(db,'organizations',dict(id=1,owner_tg_id=101,name='Бизнес',created_at=1))
    insert(db,'employees',dict(id=11,org_id=1,tg_id=111,name='Анна',hourly_kopeks=20000))
    insert(db,'locations',dict(id=10,org_id=1,name='Точка',chat_id=-1001234))
    base=dict(org_id=1,location_id=10,employee_id=11,started_at=100,hourly_kopeks_snapshot=20000,shift_bonus_kopeks_snapshot=5000,source_in='legacy',created_at=100)
    insert(db,'shifts',dict(id=1,ended_at=200,**base))
    insert(db,'shifts',dict(id=2,ended_at=None,**base))
    insert(db,'control_requests',dict(id='r',org_id=1,location_id=10,instruction='Чистота',deadline_at=999,targets='[]',created_by=101,created_at=1))
    insert(db,'control_submissions',dict(id='s',request_id='r',org_id=1,employee_id=11,device_id=1,created_at=1,expires_at=999))
    before={t['name']:db.execute('SELECT * FROM "'+t['name']+'"').fetchall() for t in old}
    org_sql=db.execute("SELECT sql FROM sqlite_master WHERE name='organizations'").fetchone()[0]
    old_by_name={t['name']:t for t in old}
    for t in new:
        previous=old_by_name.get(t['name'])
        if not previous: create(db,t);continue
        prior_cols={c['name']:c for c in previous['columns']}
        for c in t['columns']:
            if c['name'] in prior_cols:
                assert c==prior_cols[c['name']], ('changed legacy column', t['name'],c['name'])
                continue
            db.execute('ALTER TABLE "'+t['name']+'" ADD COLUMN '+column(c,True))
            if c.get('distinct'): db.execute('CREATE UNIQUE INDEX "rehearsal_'+t['name']+'_'+c['name']+'" ON "'+t['name']+'" ("'+c['name']+'")')
        prior_indexes={i['name']:i for i in previous['indexes']}
        for i in t['indexes']:
            if i['name'] in prior_indexes:
                assert i==prior_indexes[i['name']], ('changed legacy index',t['name'],i['name'])
                continue
            db.execute('CREATE '+('UNIQUE ' if i['unique'] else '')+'INDEX "'+i['name']+'" ON "'+t['name']+'" ('+','.join('"'+c+'"' for c in i['cols'])+')'+(' WHERE '+i['condition'] if 'condition' in i else ''))
    for t in old:
        selected=','.join('"'+c['name']+'"' for c in t['columns'])
        assert db.execute('SELECT '+selected+' FROM "'+t['name']+'"').fetchall()==before[t['name']]
    assert db.execute("SELECT sql FROM sqlite_master WHERE name='organizations'").fetchone()[0]==org_sql
    assert db.execute('SELECT revision FROM control_submissions').fetchone()==(0,)
    rejects(lambda:insert(db,'organizations',dict(owner_tg_id=101,name='duplicate',created_at=1)))
    rejects(lambda:insert(db,'shifts',dict(id=3,**base)))
    db.execute('UPDATE shifts SET ended_at=200 WHERE id=2')
    insert(db,'shifts',dict(id=3,ended_at=300,arrival_intent_id='intent',occurrence_key='assigned:7',**base))
    rejects(lambda:insert(db,'shifts',dict(id=4,ended_at=400,arrival_intent_id='intent',**base)))
    rejects(lambda:insert(db,'shifts',dict(id=5,ended_at=400,occurrence_key='assigned:7',**base)))
    insert(db,'shift_events',dict(shift_id=3,actor_tg_id=111,action='in',at=100,photo_intent_id='intent'))
    rejects(lambda:insert(db,'shift_events',dict(shift_id=3,actor_tg_id=111,action='in',at=100,photo_intent_id='intent')))
    sale=dict(org_id=1,employee_id=11,date='2026-10-11',amount_kopeks=-10000,rate_basis_points_snapshot=500,commission_kopeks=-500,refund_of='sale',reason='Возврат',actor_tg_id=101,created_at=100)
    insert(db,'sales_entries',dict(id='refund',**sale))
    rejects(lambda:insert(db,'sales_entries',dict(id='duplicate',**sale)))
    correction=dict(org_id=1,shift_id=1,version=1,started_at=110,ended_at=200,before='{}',reason='Ошибка',actor_tg_id=101,created_at=100)
    insert(db,'shift_corrections',dict(id='fix',**correction))
    rejects(lambda:insert(db,'shift_corrections',dict(id='fix2',**correction)))
    decision=dict(assignment_id=7,org_id=1,decision='absent',request_id='absence',payload='{}',reason='Неявка',actor_tg_id=101,created_at=100)
    insert(db,'assignment_resolutions',decision)
    rejects(lambda:insert(db,'assignment_resolutions',decision))
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    db.commit()
    with sqlite3.connect(path/'backup.db') as backup: db.backup(backup)
    with sqlite3.connect(path/'backup.db') as backup, sqlite3.connect(path/'restored.db') as restored:
        backup.backup(restored)
        assert list(db.iterdump())==list(restored.iterdump())
        assert restored.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    db.close()
print('OK: all baseline tables/rows preserved; new nullable columns/defaults, uniqueness and full SQLite backup/restore verified')
