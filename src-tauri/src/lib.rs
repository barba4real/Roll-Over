use tauri_plugin_sql::{Migration, MigrationKind};
use tauri::Manager;
use serde_json::Value;

#[tauri::command]
async fn http_get(url: String, headers: std::collections::HashMap<String, String>) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("Client build failed: {}", e))?;
    let mut request = client.get(&url);
    
    for (key, value) in headers {
        request = request.header(&key, &value);
    }
    
    let response = request.send().await.map_err(|e| format!("Request failed: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, &body[..body.len().min(200)]));
    }
    
    let text = response.text().await.map_err(|e| format!("Read body failed: {}", e))?;
    let json: Value = serde_json::from_str(&text).map_err(|e| format!("JSON parse failed: {}", e))?;
    
    Ok(json)
}

/// Proxy version: routes request through a Cloudflare Worker proxy
#[tauri::command]
async fn http_get_proxied(url: String, headers: std::collections::HashMap<String, String>, proxy_url: String) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("Client build failed: {}", e))?;

    // POST to the proxy with the target URL and headers
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
        .map_err(|e| format!("Proxy request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body_text = response.text().await.unwrap_or_default();
        return Err(format!("Proxy HTTP {}: {}", status, &body_text[..body_text.len().min(200)]));
    }

    let text = response.text().await.map_err(|e| format!("Read proxy body failed: {}", e))?;
    let json: Value = serde_json::from_str(&text).map_err(|e| format!("JSON parse failed: {}", e))?;

    Ok(json)
}

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
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus existing window when second instance tried
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
        .invoke_handler(tauri::generate_handler![http_get, http_get_proxied])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
