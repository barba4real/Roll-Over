use tauri_plugin_sql::{Migration, MigrationKind};
use tauri::Manager;
use serde_json::Value;
use std::time::Duration;

// ─── HTTP Error Categories ───────────────────────────────────────────────────

/// Classify error for the frontend so it can display helpful messages
fn classify_error(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        return "TIMEOUT: Request timed out. The server may be slow or your connection unstable.".to_string();
    }
    if e.is_connect() {
        let msg = e.to_string();
        if msg.contains("dns") || msg.contains("resolve") || msg.contains("getaddrinfo") {
            return format!("DNS_ERROR: Could not resolve hostname. Check your internet connection. ({})", msg);
        }
        if msg.contains("tls") || msg.contains("ssl") || msg.contains("certificate") || msg.contains("handshake") {
            return format!("TLS_ERROR: Secure connection failed. Your network may be blocking HTTPS. ({})", msg);
        }
        if msg.contains("refused") {
            return format!("CONNECTION_REFUSED: Server actively refused the connection. ({})", msg);
        }
        if msg.contains("reset") {
            return format!("CONNECTION_RESET: Connection was reset. ISP or firewall may be blocking. ({})", msg);
        }
        return format!("CONNECTION_ERROR: Could not connect to server. Check network/firewall. ({})", msg);
    }
    if e.is_request() {
        return format!("REQUEST_ERROR: Invalid request. ({})", e);
    }
    if e.is_body() {
        return format!("BODY_ERROR: Failed reading response body. ({})", e);
    }
    if e.is_decode() {
        return format!("DECODE_ERROR: Response was not valid UTF-8/JSON. ({})", e);
    }
    format!("UNKNOWN_ERROR: {}", e)
}

/// Build a reqwest client with sensible defaults for sports API fetching
fn build_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .connect_timeout(Duration::from_secs(10))
        .user_agent("RollOver/2.0")
        .pool_max_idle_per_host(5)
        .tcp_keepalive(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("CLIENT_BUILD_ERROR: {}", e))
}

// ─── Direct HTTP GET ─────────────────────────────────────────────────────────

#[tauri::command]
async fn http_get(url: String, headers: std::collections::HashMap<String, String>) -> Result<Value, String> {
    let client = build_client(20)?;
    let mut request = client.get(&url);

    for (key, value) in &headers {
        request = request.header(key.as_str(), value.as_str());
    }

    let response = request.send().await.map_err(|e| classify_error(&e))?;

    let status = response.status();
    if !status.is_success() {
        let status_code = status.as_u16();
        let body = response.text().await.unwrap_or_default();
        let preview = &body[..body.len().min(300)];
        return Err(format!("HTTP_{}: Server returned status {}. Body: {}", status_code, status_code, preview));
    }

    let text = response.text().await.map_err(|e| classify_error(&e))?;

    // Handle empty response gracefully
    if text.is_empty() {
        return Err("EMPTY_RESPONSE: Server returned an empty body.".to_string());
    }

    let json: Value = serde_json::from_str(&text).map_err(|e| {
        let preview = &text[..text.len().min(200)];
        format!("JSON_PARSE_ERROR: {}. Response preview: {}", e, preview)
    })?;

    Ok(json)
}

/// Diagnostic command — tests ESPN CDN connectivity from within Tauri
#[tauri::command]
async fn test_espn_cdn() -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Client build failed: {}", e))?;

    let url = "https://cdn.espn.com/core/soccer/scoreboard?xhr=1&league=eng.1";
    
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| classify_error(&e))?;

    let status = response.status().as_u16();
    let headers_str = format!("{:?}", response.headers().get("content-type"));
    let body = response.text().await.map_err(|e| format!("Body read failed: {}", e))?;
    
    let result = serde_json::json!({
        "status": status,
        "content_type": headers_str,
        "body_length": body.len(),
        "body_preview": &body[..body.len().min(500)],
        "is_json": serde_json::from_str::<Value>(&body).is_ok(),
    });

    Ok(result)
}

/// Fetch raw text content from a URL (for CSV downloads, non-JSON endpoints).
/// Returns the text wrapped in a JSON object: { "text": "...", "status": 200, "length": N }
#[tauri::command]
async fn http_get_text(url: String, headers: std::collections::HashMap<String, String>) -> Result<Value, String> {
    let client = build_client(30)?; // Longer timeout for large CSV files
    let mut request = client.get(&url);

    for (key, value) in &headers {
        request = request.header(key.as_str(), value.as_str());
    }

    let response = request.send().await.map_err(|e| classify_error(&e))?;

    let status = response.status();
    if !status.is_success() {
        let status_code = status.as_u16();
        let body = response.text().await.unwrap_or_default();
        let preview = &body[..body.len().min(300)];
        return Err(format!("HTTP_{}: Server returned status {}. Body: {}", status_code, status_code, preview));
    }

    let text = response.text().await.map_err(|e| classify_error(&e))?;
    let len = text.len();

    Ok(serde_json::json!({
        "text": text,
        "status": status.as_u16(),
        "length": len
    }))
}

// ─── Proxied HTTP GET (through Cloudflare Worker) ────────────────────────────

#[tauri::command]
async fn http_get_proxied(url: String, headers: std::collections::HashMap<String, String>, proxy_url: String) -> Result<Value, String> {
    let client = build_client(25)?; // Slightly longer timeout for proxy hop

    let proxy_endpoint = format!("{}/proxy", proxy_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "url": url,
        "headers": headers
    });

    let response = client
        .post(&proxy_endpoint)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            let classified = classify_error(&e);
            format!("PROXY_{} (proxy: {})", classified, proxy_endpoint)
        })?;

    let status = response.status();
    if !status.is_success() {
        let status_code = status.as_u16();
        let body_text = response.text().await.unwrap_or_default();
        let preview = &body_text[..body_text.len().min(300)];
        return Err(format!("PROXY_HTTP_{}: Proxy returned {}. Body: {}", status_code, status_code, preview));
    }

    let text = response.text().await.map_err(|e| {
        format!("PROXY_BODY_ERROR: Failed reading proxy response. ({})", e)
    })?;

    if text.is_empty() {
        return Err("PROXY_EMPTY_RESPONSE: Proxy returned an empty body.".to_string());
    }

    let json: Value = serde_json::from_str(&text).map_err(|e| {
        let preview = &text[..text.len().min(200)];
        format!("PROXY_JSON_PARSE_ERROR: {}. Response preview: {}", e, preview)
    })?;

    // Check if the proxy itself reported a target error (proxy returns 200 with error field)
    if let Some(error) = json.get("error").and_then(|v| v.as_str()) {
        // The proxy wraps target failures in { error: "...", status: N, body: {...} }
        // We still return the full JSON so the frontend can inspect target status
        // But log a warning
        log::warn!("Proxy reported target error: {} (for url: {})", error, url);
    }

    Ok(json)
}

// ─── App Setup ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create initial tables",
            sql: "
                CREATE TABLE IF NOT EXISTS chains (
                    id TEXT PRIMARY KEY,
                    label TEXT NOT NULL,
                    starting_stake REAL NOT NULL,
                    target_amount REAL,
                    current_step INTEGER DEFAULT 0,
                    current_stake REAL NOT NULL,
                    status TEXT DEFAULT 'active',
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    break_reason TEXT
                );

                CREATE TABLE IF NOT EXISTS slips (
                    id TEXT PRIMARY KEY,
                    chain_id TEXT NOT NULL,
                    step_number INTEGER NOT NULL,
                    accumulated_odds REAL NOT NULL,
                    quality_score REAL,
                    stake_amount REAL NOT NULL,
                    potential_return REAL NOT NULL,
                    status TEXT DEFAULT 'staked',
                    staked_at TEXT NOT NULL,
                    settled_at TEXT,
                    FOREIGN KEY (chain_id) REFERENCES chains(id)
                );

                CREATE TABLE IF NOT EXISTS slip_selections (
                    id TEXT PRIMARY KEY,
                    slip_id TEXT NOT NULL,
                    home_team TEXT NOT NULL,
                    away_team TEXT NOT NULL,
                    kick_off_time TEXT NOT NULL,
                    market TEXT NOT NULL,
                    pick TEXT NOT NULL,
                    odds REAL NOT NULL,
                    confidence REAL,
                    league TEXT,
                    provider TEXT,
                    result TEXT,
                    FOREIGN KEY (slip_id) REFERENCES slips(id)
                );

                CREATE TABLE IF NOT EXISTS match_cache (
                    id TEXT PRIMARY KEY,
                    home_team TEXT NOT NULL,
                    away_team TEXT NOT NULL,
                    kick_off_time TEXT NOT NULL,
                    league TEXT,
                    analysis_json TEXT NOT NULL,
                    cached_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS transactions (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    amount REAL NOT NULL,
                    note TEXT,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                INSERT OR IGNORE INTO settings (key, value) VALUES ('target_slip_odds', '2.0');
                INSERT OR IGNORE INTO settings (key, value) VALUES ('slip_odds_min', '1.8');
                INSERT OR IGNORE INTO settings (key, value) VALUES ('slip_odds_max', '2.5');
                INSERT OR IGNORE INTO settings (key, value) VALUES ('safe_odds_min', '1.20');
                INSERT OR IGNORE INTO settings (key, value) VALUES ('safe_odds_max', '1.50');
                INSERT OR IGNORE INTO settings (key, value) VALUES ('max_high_risk_per_slip', '1');
                INSERT OR IGNORE INTO settings (key, value) VALUES ('min_confidence', '65');
                INSERT OR IGNORE INTO settings (key, value) VALUES ('max_picks_per_slip', '4');
                INSERT OR IGNORE INTO settings (key, value) VALUES ('min_picks_per_slip', '2');
                INSERT OR IGNORE INTO settings (key, value) VALUES ('starting_stake', '100');
                INSERT OR IGNORE INTO settings (key, value) VALUES ('reminder_message', 'STICK TO THE RULES');
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create historical match data tables",
            sql: "
                CREATE TABLE IF NOT EXISTS historical_matches (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    home_team TEXT NOT NULL,
                    away_team TEXT NOT NULL,
                    date TEXT NOT NULL,
                    time TEXT,
                    season TEXT NOT NULL,
                    league_id TEXT NOT NULL,
                    division TEXT,
                    ft_home_goals INTEGER NOT NULL,
                    ft_away_goals INTEGER NOT NULL,
                    ft_result TEXT NOT NULL,
                    ht_home_goals INTEGER,
                    ht_away_goals INTEGER,
                    ht_result TEXT,
                    home_shots INTEGER,
                    away_shots INTEGER,
                    home_shots_on_target INTEGER,
                    away_shots_on_target INTEGER,
                    home_corners INTEGER,
                    away_corners INTEGER,
                    home_yellows INTEGER,
                    away_yellows INTEGER,
                    home_reds INTEGER,
                    away_reds INTEGER,
                    source TEXT,
                    UNIQUE(home_team, away_team, date, league_id)
                );

                CREATE INDEX IF NOT EXISTS idx_hist_home_team ON historical_matches(home_team);
                CREATE INDEX IF NOT EXISTS idx_hist_away_team ON historical_matches(away_team);
                CREATE INDEX IF NOT EXISTS idx_hist_league ON historical_matches(league_id);
                CREATE INDEX IF NOT EXISTS idx_hist_season ON historical_matches(season);
                CREATE INDEX IF NOT EXISTS idx_hist_date ON historical_matches(date);

                CREATE TABLE IF NOT EXISTS data_sync_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source TEXT NOT NULL,
                    league_id TEXT,
                    season TEXT,
                    matches_imported INTEGER DEFAULT 0,
                    synced_at TEXT NOT NULL,
                    status TEXT DEFAULT 'success',
                    error TEXT
                );
            ",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:rollover.db", migrations)
                .build(),
        )
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![http_get, http_get_proxied, http_get_text, test_espn_cdn])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
