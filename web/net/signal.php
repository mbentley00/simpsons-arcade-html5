<?php
// The Simpsons netplay signaling (same protocol as the Sunset Riders remake; deployed to simpsons/) (WebRTC offer/answer/ICE relay) for plain shared PHP hosting (alwaysdata, XAMPP):
// no database, no extensions; rooms are folders of small files next to this script (rooms/, denied to the web by
// rooms/.htaccess), every write under flock(), rooms expire after TTL seconds without activity.
// Only signaling goes through here (a few KB per connection); the game traffic is peer-to-peer.
//   POST ?a=host&room=K7Q2&id=abc123        -> {ok}          (claim a room; fails if a live host holds it)
//   POST ?a=join&room=K7Q2&id=def456        -> {ok, host}    (the host's id)
//   POST ?a=send&room=K7Q2&id=def456&to=abc123   body = message (JSON text, <= 64 KB)
//   GET  ?a=poll&room=K7Q2&id=abc123        -> {ok, msgs:[{from, msg}]}  (and keeps the peer alive)
//   POST ?a=leave&room=K7Q2&id=abc123
//   GET  ?a=poll&...&meta={"n":nick,"p":2,"s":0,"st":"Fase 1"}   (host only, optional, every ~5 s) -> room shows in the list
//   GET  ?a=list                            -> {ok, rooms:[{room, host, p, s, st, age}]}  (public rooms with fresh meta)
// Private rooms never send meta, so they are never listed (joinable by link/code only). Older clients that do not
// send meta are simply not listed; every other action is unchanged.
//   GET  ?a=ice                             -> {ok, ice:[RTCIceServer...]}  TURN relay credentials (see below), [] if none
// TURN (optional): copy turn_config.example.php to turn_config.php beside this file on the server you host,
// and fill that copy there. turn_config.php is gitignored. Never commit it and never send it to the browser.
// It may define one of
//   ['cloudflare_key_id' => '...', 'cloudflare_api_token' => '...']   (Cloudflare Realtime TURN)
//   ['metered_app' => 'yourapp', 'metered_api_key' => '...']           (Metered)
// Short-lived credentials (24 h) are minted here and cached 6 h in rooms/_ice.json; the secret never reaches the browser.
// Usage log (pt94u): one JSON line per event in rooms/_log/YYYY-MM.log (append under flock, kept 6 months), never
// raw IPs (visitor id = sha256(ip + random salt in rooms/_log/salt), 10 chars). Events: host, join, roster (host meta
// changed: player/spectator names), relay (guest fell back to relay-only), ice (TURN credentials asked), leave (guest),
// end (host left), expire (room timed out). Polls are not logged. Owner view: ?a=stats&k=KEY (&fmt=json), KEY =
// 'stats_key' in turn_config.php; missing or wrong key -> 403.
// Any origin may call it (the game can be served from another site, e.g. itch.io): CORS * without credentials.
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Max-Age: 86400');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') { http_response_code(204); exit; }

const TTL = 600;          // a room with no request for 10 min is deleted
const HOST_ALIVE = 30;    // a host that has not polled for 30 s no longer owns its room
const MAX_MSG = 65536, MAX_QUEUE = 262144, MAX_ROOMS = 500;
const LOG_KEEP = 183 * 86400;
const META_FRESH = 20, LIST_MAX = 50, LIST_CACHE = 3; // list: meta newer than 20 s, at most 50 rooms, cached 3 s

function out($a, $code = 200) { http_response_code($code); echo json_encode($a); exit; }
function fail($e, $code = 400) { out(['ok' => false, 'error' => $e], $code); }

$base = __DIR__ . '/rooms';
if (!is_dir($base)) { @mkdir($base, 0755, true); }
if (!is_dir($base) || !is_writable($base)) fail('rooms/ folder is not writable', 500);
if (!file_exists("$base/.htaccess")) @file_put_contents("$base/.htaccess", "Require all denied\nDeny from all\n");
if (!file_exists("$base/index.html")) @file_put_contents("$base/index.html", '');

$a = $_GET['a'] ?? '';
function clean($t, $n) { // plain short text: no control/format chars, no markup
  $t = preg_replace('/[\x{0000}-\x{001f}\x{007f}-\x{009f}\x{200b}-\x{200f}\x{2028}-\x{202e}\x{2066}-\x{2069}\x{feff}<>&"\'`\\\\]/u', '', (string)$t);
  if ($t === null) return '';
  $t = trim(preg_replace('/\s+/u', ' ', $t));
  return preg_match('/^.{0,' . (int)$n . '}/su', $t, $m) ? trim($m[0]) : ''; // first $n UTF-8 chars (no mbstring needed)
}
if ($a === 'list') {
  $cache = "$base/_list.json";
  $c = @filemtime($cache);
  if ($c !== false && time() - $c < LIST_CACHE && ($j = @file_get_contents($cache))) { echo $j; exit; }
  $rooms = [];
  foreach (glob("$base/*", GLOB_ONLYDIR) ?: [] as $d) {
    $h = hostInfo($d); if (!$h || time() - $h['t'] >= HOST_ALIVE) continue;
    $m = @json_decode(@file_get_contents("$d/meta"), true); if (!is_array($m) || !empty($m['pv']) || time() - ($m['t'] ?? 0) > META_FRESH) continue;
    $rooms[] = ['room' => basename($d), 'host' => clean($m['n'] ?? '', 12), 'p' => max(0, min(4, (int)($m['p'] ?? 1))), 's' => max(0, min(4, (int)($m['s'] ?? 0))),
      'st' => clean($m['st'] ?? '', 20), 'age' => max(0, time() - (int)($m['c'] ?? time()))];
  }
  usort($rooms, function ($x, $y) { return $x['age'] - $y['age']; });
  $j = json_encode(['ok' => true, 'rooms' => array_slice($rooms, 0, LIST_MAX)]);
  locked($cache, function ($cur) use ($j) { return $j; });
  echo $j; exit;
}
if ($a === 'stats') { statsPage($base); exit; }
if ($a === 'ice') {
  $rr = strtoupper($_GET['room'] ?? '');
  if (!empty($_GET['relay']) && preg_match('/^[A-Z0-9]{4,8}$/', $rr)) {
    if (is_file("$base/$rr/stat")) locked("$base/$rr/stat", function ($cur) { $j = json_decode($cur, true); if (!is_array($j)) return null; $j['r'] = 1; return json_encode($j); });
    slog('relay', ['room' => $rr]); echo json_encode(['ok' => true]); exit;
  }
  slog('ice', []);
  $cache = "$base/_ice.json";
  $c = @filemtime($cache);
  if ($c !== false && time() - $c < 21600 && ($j = @file_get_contents($cache))) { echo $j; exit; }
  $cfg = is_file(__DIR__ . '/turn_config.php') ? (include __DIR__ . '/turn_config.php') : null;
  $ice = [];
  function http_json($url, $method, $headers, $body) {
    if (function_exists('curl_init')) {
      $ch = curl_init($url);
      curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 6, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $headers]);
      if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
      $r = curl_exec($ch); curl_close($ch);
    } else {
      $r = @file_get_contents($url, false, stream_context_create(['http' => ['method' => $method, 'header' => implode("\r\n", $headers), 'content' => $body ?? '', 'timeout' => 6, 'ignore_errors' => true]]));
    }
    return $r ? json_decode($r, true) : null;
  }
  if (is_array($cfg) && !empty($cfg['cloudflare_key_id']) && !empty($cfg['cloudflare_api_token'])) {
    $r = http_json('https://rtc.live.cloudflare.com/v1/turn/keys/' . rawurlencode($cfg['cloudflare_key_id']) . '/credentials/generate-ice-servers', 'POST',
      ['Authorization: Bearer ' . $cfg['cloudflare_api_token'], 'Content-Type: application/json'], '{"ttl":86400}');
    foreach (($r['iceServers'] ?? []) as $s) if (!empty($s['username'])) {
      $s['urls'] = array_values(array_filter((array)$s['urls'], function ($u) { return strpos($u, ':53?') === false; })); // port 53 blocked in browsers
      $ice[] = $s;
    }
  } elseif (is_array($cfg) && !empty($cfg['metered_app']) && !empty($cfg['metered_api_key'])) {
    $r = http_json('https://' . rawurlencode($cfg['metered_app']) . '.metered.live/api/v1/turn/credentials?apiKey=' . rawurlencode($cfg['metered_api_key']), 'GET', [], null);
    if (is_array($r)) foreach ($r as $s) if (is_array($s) && !empty($s['username'])) $ice[] = $s;
  }
  $j = json_encode(['ok' => true, 'ice' => $ice]);
  if ($ice) locked($cache, function ($cur) use ($j) { return $j; });
  echo $j; exit;
}
$room = strtoupper($_GET['room'] ?? '');
$id = $_GET['id'] ?? '';
if (!preg_match('/^[A-Z0-9]{4,8}$/', $room)) fail('bad room');
if (!preg_match('/^[a-z0-9]{6,16}$/', $id)) fail('bad id');
$dir = "$base/$room";

// read-modify-write a file under an exclusive lock
function locked($path, $fn) {
  $h = fopen($path, 'c+'); if (!$h) fail('io', 500);
  flock($h, LOCK_EX);
  $cur = stream_get_contents($h);
  $new = $fn($cur === false ? '' : $cur);
  if ($new !== null) { ftruncate($h, 0); rewind($h); fwrite($h, $new); fflush($h); }
  flock($h, LOCK_UN); fclose($h);
  return $cur;
}
function rmroom($d, $ev = null) { if ($ev) roomEnd($d, $ev); return rmroom0($d); }
function rmroom0($d) { foreach (scandir($d) ?: [] as $f) if (is_file("$d/$f")) @unlink("$d/$f"); @rmdir($d); }
// ---- usage log ----
function logdir() { global $base; $d = "$base/_log"; if (!is_dir($d) && !@mkdir($d, 0755) && !is_dir($d)) error_log("ssr signal: mkdir $d failed"); return $d; }
// write without depending on LOCK_EX (network filesystems may refuse flock): flock is tried, a failure is ignored
function wfile($path, $data, $append = false) {
  $h = @fopen($path, $append ? 'a' : 'c');
  if ($h) {
    $lk = @flock($h, LOCK_EX);
    if (!$append) @ftruncate($h, 0);
    $n = @fwrite($h, $data); @fflush($h);
    if ($lk) @flock($h, LOCK_UN); @fclose($h);
    if ($n === strlen($data)) return true;
  }
  return @file_put_contents($path, $data, $append ? FILE_APPEND : 0) === strlen($data);
}
function vid() {
  $d = logdir(); $salt = @file_get_contents("$d/salt");
  if (!$salt) { $salt = bin2hex(random_bytes(16)); $h = @fopen("$d/salt", 'x'); if ($h) { fwrite($h, $salt); fclose($h); } else $salt = @file_get_contents("$d/salt") ?: $salt; }
  return substr(hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . $salt), 0, 10);
}
function slog($ev, $f) { // never fails the request
  $rec = array_merge(['t' => time(), 'e' => $ev, 'v' => vid()], $f);
  wfile(logdir() . '/' . gmdate('Y-m') . '.log', json_encode($rec, JSON_UNESCAPED_UNICODE) . "\n", true);
}
function roomEnd($dir, $ev) { // host left / room expired: one summary line from rooms/X/stat
  $st = @json_decode(@file_get_contents("$dir/stat"), true); if (!is_array($st)) return;
  @unlink("$dir/stat");
  slog($ev, ['room' => basename($dir), 'n' => $st['n'] ?? '', 'pub' => $st['pub'] ?? null, 'pk' => $st['pk'] ?? 1,
    'dur' => max(0, ($st['l'] ?? time()) - ($st['c'] ?? time())), 'pl' => $st['pl'] ?? [], 'sp' => $st['sp'] ?? [], 'r' => $st['r'] ?? 0]);
}
function hostInfo($dir) { $s = @file_get_contents("$dir/host"); if (!$s) return null; $j = json_decode($s, true); return is_array($j) ? $j : null; }

// cleanup of expired rooms (about 1 request in 20)
if (mt_rand(0, 19) === 0) {
  foreach (glob("$base/*", GLOB_ONLYDIR) ?: [] as $d) {
    $t = @filemtime("$d/.alive"); if ($t === false) $t = @filemtime($d);
    if (basename($d)[0] === '_') continue; // rooms/_log
    if ($t !== false && time() - $t > TTL) { if (is_file("$d/stat")) locked("$d/stat", function ($cur) use ($t) { $j = json_decode($cur, true); if (!is_array($j)) return null; $j['l'] = $t; return json_encode($j); }); rmroom($d, 'expire'); }
  }
  foreach (glob("$base/_log/*.log") ?: [] as $f) if (time() - (int)@filemtime($f) > LOG_KEEP) @unlink($f);
}

switch ($a) {
  case 'host':
    if (!is_dir($dir)) { if (count(glob("$base/*", GLOB_ONLYDIR) ?: []) >= MAX_ROOMS) fail('server full', 503); @mkdir($dir, 0755); }
    $ok = false; $fresh = false;
    locked("$dir/host", function ($cur) use ($id, &$ok, &$fresh) {
      $h = json_decode($cur, true);
      if (is_array($h) && $h['id'] !== $id && time() - $h['t'] < HOST_ALIVE) return null;
      $ok = true; $fresh = !is_array($h) || $h['id'] !== $id; return json_encode(['id' => $id, 't' => time()]);
    });
    if ($ok) @unlink("$dir/meta"); // a new host starts unlisted until it publishes its own meta
    if (!$ok) fail('room taken', 409);
    if ($fresh) { roomEnd($dir, 'end'); wfile("$dir/stat", json_encode(['c' => time(), 'l' => time(), 'pub' => null, 'n' => '', 'pk' => 1, 'pl' => [], 'sp' => [], 'r' => 0])); slog('host', ['room' => $room]); }
    touch("$dir/.alive"); out(['ok' => true]);
  case 'join':
    $h = is_dir($dir) ? hostInfo($dir) : null;
    if (!$h || time() - $h['t'] >= HOST_ALIVE) fail('no such room', 404);
    slog('join', ['room' => $room]);
    touch("$dir/.alive"); out(['ok' => true, 'host' => $h['id']]);
  case 'send':
    $to = $_GET['to'] ?? '';
    if (!preg_match('/^[a-z0-9]{6,16}$/', $to)) fail('bad to');
    if (!is_dir($dir)) fail('no such room', 404);
    $body = file_get_contents('php://input', false, null, 0, MAX_MSG + 1);
    if ($body === false || strlen($body) > MAX_MSG) fail('message too big', 413);
    $line = json_encode(['from' => $id, 'msg' => $body]) . "\n";
    $full = false;
    locked("$dir/q_$to", function ($cur) use ($line, &$full) { if (strlen($cur) + strlen($line) > MAX_QUEUE) { $full = true; return null; } return $cur . $line; });
    if ($full) fail('queue full', 429);
    touch("$dir/.alive"); out(['ok' => true]);
  case 'poll':
    if (!is_dir($dir)) fail('no such room', 404);
    $h = hostInfo($dir);
    if ($h && $h['id'] === $id) {
      locked("$dir/host", function ($cur) use ($id) { return json_encode(['id' => $id, 't' => time()]); });
      if (isset($_GET['meta']) && strlen($_GET['meta']) <= 900) { // public room info for the list (host only)
        $m = json_decode($_GET['meta'], true);
        if (is_array($m)) {
          $old = @json_decode(@file_get_contents("$dir/meta"), true);
          $rec = ['n' => clean($m['n'] ?? '', 12), 'p' => max(0, min(4, (int)($m['p'] ?? 1))), 's' => max(0, min(4, (int)($m['s'] ?? 0))),
            'st' => clean($m['st'] ?? '', 20), 't' => time(), 'c' => is_array($old) && isset($old['c']) ? (int)$old['c'] : time()];
          $nl = function ($a) { $o = []; foreach (array_slice(is_array($a) ? $a : [], 0, 4) as $x) { $x = clean($x, 12); if ($x !== '') $o[] = $x; } return $o; };
          $rec['pv'] = empty($m['pv']) ? 0 : 1; $rec['pl'] = $nl($m['pl'] ?? null); $rec['sp'] = $nl($m['sp'] ?? null);
          locked("$dir/meta", function ($cur) use ($rec) { return json_encode($rec); });
          $chg = null; // usage log only when the roster changes, not on every poll
          if (is_file("$dir/stat")) locked("$dir/stat", function ($cur) use ($rec, &$chg) {
            $j = json_decode($cur, true); if (!is_array($j)) return null;
            $pub = $rec['pv'] ? 0 : 1; $j['l'] = time();
            $key = json_encode([$pub, $rec['n'], $rec['p'], $rec['s'], $rec['pl'], $rec['sp']]);
            if (($j['k'] ?? '') !== $key) {
              $chg = ['pub' => $pub, 'n' => $rec['n'], 'p' => $rec['p'], 's' => $rec['s'], 'pl' => $rec['pl'], 'sp' => $rec['sp'],
                'add' => array_values(array_diff($rec['pl'], $j['pl'] ?? [])), 'adds' => array_values(array_diff($rec['sp'], $j['sp'] ?? []))];
              $j['k'] = $key; $j['pub'] = $pub; $j['n'] = $rec['n']; $j['pk'] = max($j['pk'] ?? 1, $rec['p']);
              $j['pl'] = array_values(array_unique(array_merge($j['pl'] ?? [], $rec['pl']))); $j['sp'] = array_values(array_unique(array_merge($j['sp'] ?? [], $rec['sp'])));
            }
            return json_encode($j);
          });
          if ($chg) slog('roster', ['room' => basename($dir)] + $chg);
        }
      }
    }
    $q = file_exists("$dir/q_$id") ? locked("$dir/q_$id", function ($cur) { return $cur === '' ? null : ''; }) : '';
    $msgs = [];
    foreach (explode("\n", $q) as $l) if ($l !== '') { $m = json_decode($l, true); if ($m) $msgs[] = $m; }
    touch("$dir/.alive"); out(['ok' => true, 'msgs' => $msgs, 'host' => $h ? $h['id'] : null]);
  case 'leave':
    if (is_dir($dir)) {
      $h = hostInfo($dir);
      @unlink("$dir/q_$id");
      if ($h && $h['id'] === $id) { if (is_file("$dir/stat")) locked("$dir/stat", function ($cur) { $j = json_decode($cur, true); if (!is_array($j)) return null; $j['l'] = time(); return json_encode($j); }); rmroom($dir, 'end'); }
      else slog('leave', ['room' => $room]);
    }
    out(['ok' => true]);
  default:
    fail('bad action');
}

// ---- owner stats page: ?a=stats&k=KEY[&fmt=json] ----
function statsPage($base) {
  $cfg = is_file(__DIR__ . '/turn_config.php') ? (include __DIR__ . '/turn_config.php') : null;
  $key = is_array($cfg) ? (string)($cfg['stats_key'] ?? '') : '';
  if (strlen($key) < 8 || !hash_equals($key, (string)($_GET['k'] ?? ''))) fail('forbidden', 403);
  $now = time(); $ev = [];
  for ($i = 0; $i < 2; $i++) { // this month + last month cover 30 days
    $f = "$base/_log/" . gmdate('Y-m', gmmktime(0, 0, 0, (int)gmdate('n') - $i, 1, (int)gmdate('Y'))) . '.log';
    $rd = ['f' => basename($f), 'ok' => is_file($f), 'lines' => 0, 'json' => 0];
    if (is_file($f)) foreach (file($f, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $l) { $rd['lines']++; $j = json_decode($l, true); if (is_array($j)) { $ev[] = $j; $rd['json']++; } elseif (!isset($rd['bad'])) { $rd['bad'] = substr(preg_replace('/[^\x20-\x7e]/', '?', $l), 0, 120); $rd['err'] = json_last_error_msg(); } }
    $GLOBALS['statsRead'][] = $rd;
  }
  usort($ev, function ($a, $b) { return $a['t'] - $b['t']; });
  $tz = new DateTimeZone('America/Sao_Paulo');
  $today = (new DateTime('today', $tz))->getTimestamp();
  $per = ['hoje' => $today, '7d' => $now - 7 * 86400, '30d' => $now - 30 * 86400];
  $S = [];
  foreach ($per as $k => $from) {
    $rooms = 0; $vis = []; $durs = []; $relay = []; $cur = []; $peak = 0;
    foreach ($ev as $e) {
      $r = $e['room'] ?? '';
      if ($e['e'] === 'host') { $cur[$r] = 1; } elseif ($e['e'] === 'roster' && isset($cur[$r])) { $cur[$r] = (int)$e['p']; }
      elseif ($e['e'] === 'end' || $e['e'] === 'expire') unset($cur[$r]);
      if ($e['t'] < $from) continue;
      $peak = max($peak, array_sum($cur));
      $vis[$e['v']] = 1;
      if ($e['e'] === 'host') $rooms++;
      if (($e['e'] === 'end' || $e['e'] === 'expire') && isset($e['dur'])) $durs[] = $e['dur'];
      if ($e['e'] === 'relay') $relay[$r] = 1;
    }
    $S[$k] = ['salas' => $rooms, 'visitantes' => count($vis), 'pico_jogadores' => $peak,
      'duracao_media_s' => $durs ? (int)round(array_sum($durs) / count($durs)) : null, 'salas_com_relay' => count($relay)];
  }
  // rooms open now
  $open = [];
  foreach (glob("$base/*", GLOB_ONLYDIR) ?: [] as $d) {
    if (basename($d)[0] === '_') continue;
    $h = hostInfo($d); if (!$h || $now - $h['t'] >= HOST_ALIVE) continue;
    $m = @json_decode(@file_get_contents("$d/meta"), true); $st = @json_decode(@file_get_contents("$d/stat"), true);
    $open[basename($d)] = ['room' => basename($d), 'n' => $m['n'] ?? '', 'p' => (int)($m['p'] ?? 1), 's' => (int)($m['s'] ?? 0),
      'pub' => is_array($m) ? (empty($m['pv']) ? 1 : 0) : null, 'fase' => $m['st'] ?? '', 'desde' => (int)($st['c'] ?? $m['c'] ?? $h['t'])];
  }
  // recent rooms: one row per hosted session
  $rs = []; $byRoom = [];
  foreach ($ev as $e) {
    $r = $e['room'] ?? ''; if ($r === '') continue;
    if ($e['e'] === 'host') { $rs[] = ['room' => $r, 'n' => '', 'pl' => [], 'sp' => [], 'pub' => null, 'ini' => $e['t'], 'dur' => null, 'relay' => 0, 'aberta' => 0, 'entradas' => 0]; $byRoom[$r] = count($rs) - 1; continue; }
    if (!isset($byRoom[$r])) continue; $x = &$rs[$byRoom[$r]];
    if ($e['e'] === 'roster') { $x['n'] = $e['n']; $x['pub'] = $e['pub']; $x['pl'] = array_values(array_unique(array_merge($x['pl'], $e['pl'] ?? []))); $x['sp'] = array_values(array_unique(array_merge($x['sp'], $e['sp'] ?? []))); }
    if ($e['e'] === 'join') $x['entradas']++;
    if ($e['e'] === 'relay') $x['relay'] = 1;
    if ($e['e'] === 'end' || $e['e'] === 'expire') { $x['dur'] = $e['dur'] ?? null; if (!empty($e['r'])) $x['relay'] = 1; if ($e['n'] ?? '') $x['n'] = $e['n']; if (($e['pub'] ?? null) !== null) $x['pub'] = $e['pub'];
      $x['pl'] = array_values(array_unique(array_merge($x['pl'], $e['pl'] ?? []))); $x['sp'] = array_values(array_unique(array_merge($x['sp'], $e['sp'] ?? []))); unset($byRoom[$r]); }
    unset($x);
  }
  foreach ($byRoom as $r => $i) if (isset($open[$r])) { $rs[$i]['aberta'] = 1; $rs[$i]['dur'] = $now - $rs[$i]['ini']; }
  $rs = array_slice(array_reverse($rs), 0, 50);
  $last = array_slice(array_reverse($ev), 0, 50);
  // diagnostics (owner only): can we write the log folder?
  $ld = "$base/_log"; $lf = "$ld/" . gmdate('Y-m') . '.log'; error_clear_last();
  $tw = wfile("$ld/_diag", (string)$now); $le = error_get_last(); clearstatcache();
  $diag = ['base_dir' => is_dir($base), 'base_writable' => is_writable($base), 'log_dir' => is_dir($ld), 'log_writable' => is_writable($ld),
    'log_file' => is_file($lf), 'log_size' => is_file($lf) ? filesize($lf) : null, 'test_write' => $tw, 'test_error' => $le ? $le['message'] : null,
    'flock' => (function () use ($ld) { $h = @fopen("$ld/_diag", 'c'); if (!$h) return null; $r = @flock($h, LOCK_EX); if ($r) flock($h, LOCK_UN); fclose($h); return $r; })(), 'php' => PHP_VERSION, 'ver' => 'v3', 'lidos' => $GLOBALS['statsRead'] ?? []];
  if (($_GET['fmt'] ?? '') === 'json') out(['ok' => true, 'diag' => $diag, 'agora' => $now, 'periodos' => $S, 'abertas' => array_values($open), 'salas_recentes' => $rs, 'eventos' => $last]);
  header('Content-Type: text/html; charset=utf-8');
  $E = function ($x) { return htmlspecialchars((string)$x, ENT_QUOTES, 'UTF-8'); };
  $T = function ($t) use ($tz) { return (new DateTime('@' . (int)$t))->setTimezone($tz)->format('d/m H:i:s'); };
  $D = function ($s) { if ($s === null) return '—'; $s = (int)$s; return $s >= 3600 ? sprintf("%dh%02dm", intdiv($s, 3600), intdiv($s, 60) % 60) : sprintf("%dm%02ds", intdiv($s, 60), $s % 60); };
  $P = function ($p) { return $p === null ? '?' : ($p ? 'pública' : 'privada'); };
  $names = ['host' => 'sala criada', 'join' => 'entrou', 'roster' => 'jogadores mudaram', 'relay' => 'usou relay', 'ice' => 'pediu TURN', 'leave' => 'saiu', 'end' => 'sala encerrada', 'expire' => 'sala expirou'];
  echo '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>The Simpsons — estatísticas online</title><style>
body{font:14px system-ui,sans-serif;background:#1b1410;color:#f3e6cf;margin:20px}h1{color:#ffb347;margin:0 0 4px}h2{color:#ffcf7a;margin:24px 0 8px;font-size:17px}
table{border-collapse:collapse;width:100%;background:#2a1f18}td,th{border:1px solid #4a382a;padding:5px 8px;text-align:left;vertical-align:top}th{background:#3a2a1e;color:#ffcf7a}
.cards{display:flex;gap:12px;flex-wrap:wrap}.c{background:#2a1f18;border:1px solid #4a382a;padding:10px 14px;border-radius:8px;min-width:150px}.c b{font-size:22px;color:#ffb347;display:block}
.s{color:#9fc7ff}.ok{color:#8fe08f}small{color:#b8a58a}</style></head><body><h1>The Simpsons — quem está jogando online</h1><small>Atualizado em ' . $T($now) . ' (horário de Brasília). Dados dos últimos 30 dias.</small>';
  $lab = ['hoje' => 'Hoje', '7d' => 'Últimos 7 dias', '30d' => 'Últimos 30 dias'];
  echo '<h2>Resumo</h2><table><tr><th></th><th>Salas criadas</th><th>Visitantes únicos</th><th>Pico de jogadores ao mesmo tempo</th><th>Duração média da sala</th><th>Salas que precisaram do relay (TURN)</th></tr>';
  foreach ($S as $k => $v) echo '<tr><th>' . $lab[$k] . '</th><td>' . $v['salas'] . '</td><td>' . $v['visitantes'] . '</td><td>' . $v['pico_jogadores'] . '</td><td>' . $D($v['duracao_media_s']) . '</td><td>' . $v['salas_com_relay'] . '</td></tr>';
  echo '</table><h2>Salas abertas agora (' . count($open) . ')</h2>';
  if (!$open) echo '<small>Nenhuma sala aberta neste momento.</small>';
  else { echo '<table><tr><th>Sala</th><th>Anfitrião</th><th>Jogadores</th><th>Espectadores</th><th>Tipo</th><th>Fase</th><th>Aberta desde</th></tr>';
    foreach ($open as $o) echo '<tr><td><b>' . $E($o['room']) . '</b></td><td>' . $E($o['n']) . '</td><td>' . $o['p'] . '</td><td>' . $o['s'] . '</td><td>' . $P($o['pub']) . '</td><td>' . $E($o['fase']) . '</td><td>' . $T($o['desde']) . '</td></tr>';
    echo '</table>'; }
  echo '<h2>Salas recentes</h2><table><tr><th>Sala</th><th>Anfitrião</th><th>Participantes</th><th>Tipo</th><th>Início</th><th>Duração</th><th>Relay</th><th>Situação</th></tr>';
  foreach ($rs as $x) {
    $pp = array_map(function ($n) use ($E) { return $E($n); }, $x['pl']);
    foreach ($x['sp'] as $n) $pp[] = '<span class="s">' . $E($n) . ' (espectador)</span>';
    echo '<tr><td><b>' . $E($x['room']) . '</b></td><td>' . $E($x['n'] ?: '—') . '</td><td>' . ($pp ? implode(', ', $pp) : '<small>sem nomes (' . $x['entradas'] . ' entrada(s))</small>') . '</td><td>' . $P($x['pub']) . '</td><td>' . $T($x['ini']) . '</td><td>' . $D($x['dur']) . '</td><td>' . ($x['relay'] ? 'sim' : 'não') . '</td><td>' . ($x['aberta'] ? '<span class="ok">aberta</span>' : 'encerrada') . '</td></tr>';
  }
  echo '</table><h2>Últimos 50 eventos</h2><table><tr><th>Quando</th><th>Evento</th><th>Sala</th><th>Detalhes</th><th>Visitante</th></tr>';
  foreach ($last as $e) {
    $det = [];
    if (!empty($e['n'])) $det[] = 'anfitrião ' . $E($e['n']);
    if (isset($e['p'])) $det[] = $e['p'] . ' jogador(es), ' . ($e['s'] ?? 0) . ' espectador(es)';
    if (!empty($e['add'])) $det[] = 'entrou: ' . $E(implode(', ', $e['add']));
    if (!empty($e['adds'])) $det[] = 'espectador: ' . $E(implode(', ', $e['adds']));
    if (array_key_exists('pub', $e) && $e['pub'] !== null) $det[] = $P($e['pub']);
    if (isset($e['dur'])) $det[] = 'durou ' . $D($e['dur']);
    echo '<tr><td>' . $T($e['t']) . '</td><td>' . ($names[$e['e']] ?? $E($e['e'])) . '</td><td>' . $E($e['room'] ?? '') . '</td><td>' . implode(' · ', $det) . '</td><td><small>' . $E($e['v']) . '</small></td></tr>';
  }
  $B = function ($v) { return $v === null ? '—' : ($v === true ? 'sim' : ($v === false ? 'não' : (string)$v)); };
  echo '</table><p><small>Diagnóstico: pasta rooms ' . $B($diag['base_dir']) . ' (gravável ' . $B($diag['base_writable']) . ') · _log ' . $B($diag['log_dir']) . ' (gravável ' . $B($diag['log_writable']) . ') · log do mês ' . $B($diag['log_file']) . ' (' . $B($diag['log_size']) . ' bytes) · teste de gravação ' . $B($diag['test_write']) . ($diag['test_error'] ? ' — ' . $E($diag['test_error']) : '') . ' · flock ' . $B($diag['flock']) . ' · PHP ' . $E($diag['php']) . '</small></p>';
  echo '<p><small>Visitante = código anônimo (hash com sal) — nenhum IP é guardado. Logs com mais de 6 meses são apagados automaticamente.</small></p></body></html>';
}
