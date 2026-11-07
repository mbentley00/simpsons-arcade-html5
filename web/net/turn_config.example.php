<?php
// Copy this file to turn_config.php next to signal.php, on a server you administer.
// Fill the copy there. Do not commit turn_config.php, and do not put a real token in this example.
// The page in the browser never reads this file. It asks signal.php?a=ice for short-lived TURN
// credentials. If that request fails, the page keeps the public STUN servers and adds no other relay.
return [
    // 'cloudflare_key_id' => '',
    // 'cloudflare_api_token' => '',
    // 'metered_app' => '',
    // 'metered_api_key' => '',
    // 'stats_key' => '',
];
