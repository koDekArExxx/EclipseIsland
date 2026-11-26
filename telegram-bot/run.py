#!/usr/bin/env python3
"""Load a simple KEY=value .env without executing shell code, then run the bot."""
import os
from pathlib import Path

def load_env(path):
    if not path.exists():
        return
    for number,line in enumerate(path.read_text(encoding='utf-8-sig').splitlines(),1):
        line=line.strip()
        if not line or line.startswith('#'):
            continue
        key,separator,value=line.partition('=')
        if not separator or not key.replace('_','').isalnum() or key[0].isdigit():
            raise ValueError('Invalid .env line '+str(number))
        value=value.strip()
        if len(value)>1 and value[0]==value[-1] and value[0] in ('"',"'"):
            value=value[1:-1]
        os.environ.setdefault(key,value)

if __name__=='__main__':
    load_env(Path(__file__).with_name('.env'))
    import bot
    bot.main()
