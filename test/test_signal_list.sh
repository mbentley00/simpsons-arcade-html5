#!/bin/bash
# signal.php 'list' + meta: php -l, php -S (PHP_CLI_SERVER_WORKERS=8 for real concurrency), sanitizing, host-only meta,
# unlisted private/old-client rooms, stale meta hidden, 40 parallel meta+list requests under flock, old actions unchanged.
set -e; D=$(mktemp -d); cp "$(dirname "$0")/../web/net/signal.php" $D/; php -l $D/signal.php
P=$((20000 + RANDOM % 20000)); PHP_CLI_SERVER_WORKERS=8 php -S 127.0.0.1:$P -t $D >$D/log 2>&1 & S=$!; trap "kill $S; rm -rf $D" EXIT; sleep 1
U=http://127.0.0.1:$P/signal.php; ok=1; chk() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; ok=0; fi; }
for r in AAAA BBBB CCCC DDDD; do curl -s -XPOST "$U?a=host&room=$r&id=host${r,,}" >/dev/null; done
M=$(python3 -c 'import urllib.parse,json;print(urllib.parse.quote(json.dumps({"n":"<b>Zé</b>\u0007 do Rifle longo","p":9,"s":2,"st":"Fase 3"})))')
curl -s "$U?a=poll&room=AAAA&id=hostaaaa&meta=$M" >/dev/null
curl -s "$U?a=poll&room=BBBB&id=hostbbbb&meta=%7B%22n%22%3A%22Ana%22%2C%22p%22%3A2%7D" >/dev/null
curl -s "$U?a=poll&room=CCCC&id=hostcccc" >/dev/null                      # private / old client: no meta
curl -s "$U?a=poll&room=DDDD&id=hostdddd&meta=%7B%22n%22%3A%22X%22%7D" >/dev/null
python3 - $D/rooms/DDDD/meta <<'P'
import json,sys; m=json.load(open(sys.argv[1])); m['t']-=30; json.dump(m,open(sys.argv[1],'w'))
P
curl -s "$U?a=poll&room=BBBB&id=guestzz1&meta=%7B%22n%22%3A%22HACK%22%7D" >/dev/null   # not the host: ignored
L=$(curl -s "$U?a=list"); echo "$L"
chk "public rooms listed, private/stale not" "python3 -c \"import json,sys;r=json.loads(sys.argv[1])['rooms'];assert sorted(x['room'] for x in r)==['AAAA','BBBB']\" '$L'"
chk "nick sanitized + clamped" "python3 -c \"import json,sys;r={x['room']:x for x in json.loads(sys.argv[1])['rooms']};a=r['AAAA'];assert a['host']=='bZé/b do Rif' and a['p']==4 and a['s']==2 and a['st']=='Fase 3';assert r['BBBB']['host']=='Ana'\" '$L'"
chk "private room joinable by code" "curl -s -XPOST '$U?a=join&room=CCCC&id=guesty1' | grep -q hostcccc"
for i in $(seq 1 40); do curl -s "$U?a=poll&room=AAAA&id=hostaaaa&meta=$M" -o $D/p$i & curl -s "$U?a=list" -o $D/l$i & W="$W $!"; done; wait $W
chk "40 parallel poll+list valid" "python3 -c \"import json,glob;[json.load(open(f)) for f in glob.glob('$D/[lp]*[0-9]')]\" && python3 -c \"import json;json.load(open('$D/rooms/AAAA/meta'))\""
chk "old actions: bad action/room" "curl -s '$U?a=zzz&room=AAAA&id=hostaaaa' | grep -q 'bad action'"
curl -s -XPOST "$U?a=leave&room=BBBB&id=hostbbbb" >/dev/null; sleep 3.2
chk "left room gone from list (after 3 s cache)" "! curl -s '$U?a=list' | grep -q BBBB"
grep -q "Fatal\|Warning" $D/log && { echo "FAIL php errors"; grep "Fatal\|Warning" $D/log | head; ok=0; }
[ $ok = 1 ] && echo ALL PASS || { echo SOME FAILED; exit 1; }
