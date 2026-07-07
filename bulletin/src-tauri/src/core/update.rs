use serde::Deserialize;
use std::fs;
use std::path::Path;
use futures_util::StreamExt;
use super::notify::NotifyQueue;

#[derive(Deserialize)]
struct GHAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Deserialize)]
struct GHRelease {
    tag_name: String,
    assets: Vec<GHAsset>,
}

pub async fn run_update_check(
    settings_path: &str,
    base_dir: &str,
    app_key: &str,
    notify: &NotifyQueue,
    log: impl Fn(&str),
) -> bool {
    let content = match fs::read_to_string(settings_path) {
        Ok(c) => c,
        Err(e) => { log(&format!("update: settings read error — {}", e)); return false; }
    };
    let settings: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(e) => { log(&format!("update: settings parse error — {}", e)); return false; }
    };

    let repo      = settings["hub.repo"].as_str().unwrap_or("");
    let auto_upd  = settings["hub.auto-update"].as_bool().unwrap_or(true);
    let local_tag = settings["hub.tag"].as_str().unwrap_or("");
    let zip_name  = settings[app_key].as_str().unwrap_or("");

    log(&format!("update: repo={} tag={} zip={} auto={}",
        if repo.is_empty() { "(없음)" } else { repo },
        if local_tag.is_empty() { "(없음)" } else { local_tag },
        if zip_name.is_empty() { "(없음)" } else { zip_name },
        auto_upd));

    if repo.is_empty()     { log("update: hub.repo not set"); return false; }
    if zip_name.is_empty() { log(&format!("update: {} not set", app_key)); return false; }
    if !auto_upd           { log("update: auto-update disabled"); return false; }

    let ua = repo.split('/').nth(1).unwrap_or(repo);
    let api_url = format!("https://api.github.com/repos/{}/releases/latest", repo);
    log(&format!("update: GET {}", api_url));

    let resp = match reqwest::Client::new()
        .get(&api_url)
        .header("User-Agent", ua)
        .timeout(std::time::Duration::from_secs(10))
        .send().await
    {
        Ok(r) => r,
        Err(e) => { log(&format!("update: GitHub API error — {}", e)); return false; }
    };
    let release: GHRelease = match resp.json::<GHRelease>().await {
        Ok(r) => r,
        Err(e) => { log(&format!("update: parse error — {}", e)); return false; }
    };

    let latest_tag = &release.tag_name;
    log(&format!("update: fetched tag={} assets=[{}]",
        latest_tag, release.assets.iter().map(|a| a.name.as_str()).collect::<Vec<_>>().join(", ")));

    if !local_tag.is_empty() && local_tag == latest_tag {
        log(&format!("update: already on {}", local_tag));
        return false;
    }

    log(&format!("update: {} → {}", if local_tag.is_empty() { "none" } else { local_tag }, latest_tag));

    let asset = match release.assets.iter().find(|a| a.name == zip_name) {
        Some(a) => a,
        None => { log(&format!("update: {} not found in release assets", zip_name)); return false; }
    };

    // 업데이트 알림 시작 — handle 로 진행상황 push
    let handle = notify.update_start(latest_tag.clone());

    if notify.is_update_cancelled() { log("update: cancelled before download"); return false; }

    let tmp_dir = Path::new(base_dir).join("tmp");
    if let Err(e) = fs::create_dir_all(&tmp_dir) {
        log(&format!("update: tmp dir error — {}", e)); return false;
    }

    let zip_path = tmp_dir.join(zip_name);
    log(&format!("update: downloading {}", zip_name));
    handle.status("다운로드 준비 중...");

    // 스트리밍 다운로드 + 진행률 + 취소 체크
    let dl_resp = match reqwest::get(&asset.browser_download_url).await {
        Ok(r) => r,
        Err(e) => { log(&format!("update: download request failed — {}", e)); return false; }
    };
    let total = dl_resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut bytes: Vec<u8> = Vec::new();
    let mut stream = dl_resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        if notify.is_update_cancelled() {
            log("update: cancelled during download");
            return false;
        }
        match chunk {
            Ok(c) => {
                downloaded += c.len() as u64;
                bytes.extend_from_slice(&c);
                if total > 0 {
                    let pct = ((downloaded * 80 / total) as u8).min(80);
                    handle.progress(pct);
                }
            }
            Err(e) => { log(&format!("update: stream error — {}", e)); return false; }
        }
    }

    if let Err(e) = fs::write(&zip_path, &bytes) {
        log(&format!("update: write error — {}", e)); return false;
    }
    log(&format!("update: download complete — {} bytes", bytes.len()));

    if notify.is_update_cancelled() { log("update: cancelled after download"); return false; }

    // 압축 해제
    log("update: extracting...");
    handle.status("압축 해제 중...");
    handle.progress(85);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let zip_str = zip_path.to_string_lossy().replace('\'', "''");
        let tmp_str = tmp_dir.to_string_lossy().replace('\'', "''");
        let result = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command",
                &format!("Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force", zip_str, tmp_str)])
            .creation_flags(0x08000000)
            .output();
        match result {
            Ok(o) if o.status.success() => log("update: extracted"),
            Ok(o) => { log(&format!("update: extract failed — {}", String::from_utf8_lossy(&o.stderr))); return false; }
            Err(e) => { log(&format!("update: extract error — {}", e)); return false; }
        }
    }

    if notify.is_update_cancelled() { log("update: cancelled after extract"); return false; }

    let exe_name = zip_name.replace(".zip", ".exe");
    let bat_name = exe_name.replace(".exe", "_update.bat");
    let bat_path = Path::new(base_dir).join(&bat_name);

    if let Err(e) = write_bat(&bat_path.to_string_lossy(), base_dir, &tmp_dir.to_string_lossy(), &[&exe_name], zip_name) {
        log(&format!("update: bat write error — {}", e)); return false;
    }
    log(&format!("update: bat written to {}", bat_path.display()));

    // hub.tag 저장
    if let Ok(c) = fs::read_to_string(settings_path) {
        if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&c) {
            v["hub.tag"] = serde_json::json!(latest_tag);
            let _ = fs::write(settings_path, serde_json::to_string_pretty(&v).unwrap_or(c));
            log(&format!("update: hub.tag saved as {}", latest_tag));
        }
    }

    handle.progress(95);
    handle.status("재시작 준비 중...");

    // bat 실행 (Job Object 탈출)
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let bat_str = bat_path.to_string_lossy().replace('\'', "''");
        match std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden",
                "-Command", &format!("Start-Process cmd.exe -ArgumentList '/C \"{}\"' -WindowStyle Hidden", bat_str)])
            .creation_flags(0x08000000)
            .spawn()
        {
            Ok(mut child) => { child.wait().ok(); log("update: bat spawned"); }
            Err(e) => { log(&format!("update: spawn error — {}", e)); return false; }
        }
    }

    handle.done();
    true
}

fn write_bat(bat_path: &str, base_dir: &str, tmp_dir: &str, app_names: &[&str], zip_name: &str) -> Result<(), String> {
    let log_path = Path::new(tmp_dir).join("update.log").to_string_lossy().to_string();

    let mut lines: Vec<String> = vec![
        "@echo off".into(),
        format!("echo [%DATE% %TIME%] === update.bat START === > \"{}\"", log_path),
    ];

    for (i, name) in app_names.iter().enumerate() {
        lines.push(format!("set WAS_RUNNING_{}=0", i));
        lines.push(format!("tasklist /FI \"IMAGENAME eq {}\" 2>nul | find /I \"{}\" >nul", name, name));
        lines.push(format!("if not errorlevel 1 set WAS_RUNNING_{}=1", i));
    }

    lines.push("ping -n 4 127.0.0.1 >nul".into());

    for name in app_names {
        lines.push(format!("taskkill /F /IM {} >nul 2>&1", name));
    }
    lines.push("ping -n 2 127.0.0.1 >nul".into());

    for name in app_names {
        let src  = Path::new(tmp_dir).join(name).to_string_lossy().to_string();
        let dest = Path::new(base_dir).join(name).to_string_lossy().to_string();
        let bak  = format!("{}.bak", dest);
        lines.push(format!("if exist \"{}\" del /F /Q \"{}\" >nul 2>&1", dest, bak));
        lines.push(format!("if exist \"{}\" move /Y \"{}\" \"{}\" >nul 2>&1", dest, dest, bak));
        lines.push(format!("move /Y \"{}\" \"{}\" >nul 2>&1", src, dest));
        lines.push(format!("if not exist \"{}\" if exist \"{}\" move /Y \"{}\" \"{}\" >nul 2>&1", dest, bak, bak, dest));
        lines.push(format!("if exist \"{}\" if exist \"{}\" del /F /Q \"{}\" >nul 2>&1", dest, bak, bak));
    }

    for (i, name) in app_names.iter().enumerate() {
        let dest = Path::new(base_dir).join(name).to_string_lossy().to_string();
        lines.push(format!("if %WAS_RUNNING_{}%==1 if exist \"{}\" start \"\" \"{}\" --post-update", i, dest, dest));
    }

    let zip_path = Path::new(tmp_dir).join(zip_name).to_string_lossy().to_string();
    lines.push(format!("if exist \"{}\" del /F /Q \"{}\" >nul 2>&1", zip_path, zip_path));
    lines.push("(goto) 2>nul & del \"%~f0\"".into());

    fs::write(bat_path, lines.join("\r\n").as_bytes()).map_err(|e| e.to_string())
}
