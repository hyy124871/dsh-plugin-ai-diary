"""读出 Chromium cookie 库里的 bilibili 条目（只读、immutable，绕过浏览器的文件锁）。

给 scripts/grab-cookie.mjs 用：Node 的 sqlite 打不开被锁住的库时，退到这里取数据，
解密仍在 Node 里做（DPAPI + AES-GCM）。

输出：JSON 数组，每项 {host, name, value, enc(base64), err}
"""

import base64
import json
import os
import sqlite3
import sys

NAMES = ['SESSDATA', 'bili_jct', 'buvid3', 'buvid4', 'DedeUserID']

def dump(db_path):
    uri = 'file:///' + db_path.replace('\\', '/').replace(' ', '%20').replace('#', '%23').replace('?', '%3F') + '?mode=ro&immutable=1'
    conn = sqlite3.connect(uri, uri=True)
    cur = conn.cursor()
    cur.execute(
        "select host_key, name, value, encrypted_value from cookies "
        "where host_key like '%bilibili%' and name in (%s)" % ','.join('?' * len(NAMES)),
        NAMES,
    )
    rows = []
    for host, name, value, enc in cur.fetchall():
        rows.append({
            'host': host,
            'name': name,
            'value': value or '',
            'enc': base64.b64encode(enc).decode() if enc else '',
        })
    conn.close()
    return rows

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'ok': False, 'error': '需要 cookie 库路径'}))
        sys.exit(2)
    try:
        print(json.dumps({'ok': True, 'rows': dump(sys.argv[1])}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'ok': False, 'error': str(e)}))
        sys.exit(3)
