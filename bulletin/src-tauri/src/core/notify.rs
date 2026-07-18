use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use tokio::sync::mpsc;
use tauri::{AppHandle, Emitter, Manager};
use serde::Serialize;

// ── 프론트엔드 이벤트 ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
pub enum ToastEvent {
    #[serde(rename = "chat")]
    Chat { id: u64, sender: String, text: String },

    #[serde(rename = "notice")]
    Notice { id: u64, #[serde(rename = "noticeId")] notice_id: String, title: String },

    #[serde(rename = "update")]
    Update { msg: String, pct: Option<u8>, done: bool },

    #[serde(rename = "updateCancelled")]
    UpdateCancelled,
}

// ── 창 마운트 시 단일 이벤트 조회용 managed state ─────────────────────────────

pub struct PendingEvents(pub Mutex<HashMap<String, ToastEvent>>);

// ── 스케줄러 내부 명령 ────────────────────────────────────────────────────────

pub enum NotifyCmd {
    Chat          { sender: String, text: String },
    Notice        { notice_id: String, title: String },
    UpdateStart   { version: String },
    UpdateProgress { pct: u8 },
    UpdateStatus  { msg: String },
    UpdateDone,
    CancelUpdate,
    WindowClosed  { label: String },
}

// ── UpdateHandle ─────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct UpdateHandle {
    tx: mpsc::Sender<NotifyCmd>,
}

impl UpdateHandle {
    pub fn progress(&self, pct: u8) {
        let _ = self.tx.try_send(NotifyCmd::UpdateProgress { pct });
    }
    pub fn status(&self, msg: impl Into<String>) {
        let _ = self.tx.try_send(NotifyCmd::UpdateStatus { msg: msg.into() });
    }
    pub fn done(&self) {
        let _ = self.tx.try_send(NotifyCmd::UpdateDone);
    }
}

// ── 외부 큐 핸들 ─────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct NotifyQueue {
    tx:               mpsc::Sender<NotifyCmd>,
    update_cancelled: Arc<AtomicBool>,
}

impl NotifyQueue {
    pub fn chat(&self, sender: impl Into<String>, text: impl Into<String>) {
        let _ = self.tx.try_send(NotifyCmd::Chat { sender: sender.into(), text: text.into() });
    }

    pub fn notice(&self, notice_id: impl Into<String>, title: impl Into<String>) {
        let _ = self.tx.try_send(NotifyCmd::Notice { notice_id: notice_id.into(), title: title.into() });
    }

    pub fn update_start(&self, version: impl Into<String>) -> UpdateHandle {
        self.update_cancelled.store(false, Ordering::Relaxed);
        let _ = self.tx.try_send(NotifyCmd::UpdateStart { version: version.into() });
        UpdateHandle { tx: self.tx.clone() }
    }

    pub fn cancel_update(&self) {
        self.update_cancelled.store(true, Ordering::Relaxed);
        let _ = self.tx.try_send(NotifyCmd::CancelUpdate);
    }

    pub fn is_update_cancelled(&self) -> bool {
        self.update_cancelled.load(Ordering::Relaxed)
    }

    pub fn window_closed(&self, label: String) {
        let _ = self.tx.try_send(NotifyCmd::WindowClosed { label });
    }
}

// ── 팩토리 ───────────────────────────────────────────────────────────────────

pub fn create() -> (NotifyQueue, mpsc::Receiver<NotifyCmd>) {
    let (tx, rx) = mpsc::channel(64);
    let queue = NotifyQueue { tx, update_cancelled: Arc::new(AtomicBool::new(false)) };
    (queue, rx)
}

// ── 활성 창 추적 구조체 ───────────────────────────────────────────────────────

struct WinInfo {
    label:    String,
    x:        i32,
    y:        i32,
    phys_h:   i32,
    phys_gap: i32,
}

// ── 창 생성 ──────────────────────────────────────────────────────────────────

fn create_window(app: &AppHandle, log_path: &str, label: &str, event: ToastEvent, slot: usize, data_dir: &Path) -> Option<WinInfo> {
    let h: f64 = match &event { ToastEvent::Update { .. } => 110.0, _ => 84.0 };

    if let Some(pending) = app.try_state::<PendingEvents>() {
        pending.0.lock().unwrap().insert(label.to_string(), event);
    }

    let monitor  = app.primary_monitor().ok().flatten()?;
    let pos      = monitor.position();
    let sz       = monitor.size();
    let scale    = monitor.scale_factor();
    let w        = 380.0_f64;
    let gap      = 8.0_f64;
    let phys_h   = (h   * scale) as i32;
    let phys_gap = (gap * scale) as i32;
    let phys_w   = (w   * scale) as i32;

    let x = pos.x + sz.width  as i32 - phys_w - (16.0 * scale) as i32;
    let y = pos.y + sz.height as i32
          - (60.0 * scale) as i32
          - phys_h
          - (slot as i32 * (phys_h + phys_gap));

    super::system::log(log_path, &format!("toast: '{}' slot={} pos=({},{})", label, slot, x, y));

    match tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App("index.html".into()))
        .title(label)
        .inner_size(w, h)
        .decorations(false)
        .transparent(true)
        .background_color(tauri::webview::Color(0, 0, 0, 0))
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(true)
        .data_directory(data_dir.to_path_buf())
        .build()
    {
        Ok(win) => {
            let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
            Some(WinInfo { label: label.to_string(), x, y, phys_h, phys_gap })
        }
        Err(e) => {
            super::system::log(log_path, &format!("toast: create error: {}", e));
            None
        }
    }
}

// ── 자율 스케줄러 ─────────────────────────────────────────────────────────────

pub async fn run_scheduler(mut rx: mpsc::Receiver<NotifyCmd>, app: AppHandle, log_path: String, data_dir: PathBuf) {
    let mut next_id:      u64            = 1;
    let mut active:       Vec<WinInfo>   = Vec::new();
    let mut update_label: Option<String> = None;

    super::system::log(&log_path, "notify: scheduler started");

    while let Some(cmd) = rx.recv().await {
        match cmd {
            NotifyCmd::Chat { sender, text } => {
                active.retain(|w| app.get_webview_window(&w.label).is_some());
                let label = format!("toast_{}", next_id); next_id += 1;
                if let Some(info) = create_window(&app, &log_path, &label,
                    ToastEvent::Chat { id: next_id, sender, text }, active.len(), &data_dir)
                {
                    active.push(info);
                }
            }

            NotifyCmd::Notice { notice_id, title } => {
                active.retain(|w| app.get_webview_window(&w.label).is_some());
                let label = format!("toast_{}", next_id); next_id += 1;
                if let Some(info) = create_window(&app, &log_path, &label,
                    ToastEvent::Notice { id: next_id, notice_id, title }, active.len(), &data_dir)
                {
                    active.push(info);
                }
            }

            NotifyCmd::UpdateStart { version } => {
                if let Some(ref lbl) = update_label {
                    if let Some(win) = app.get_webview_window(lbl) {
                        win.emit("toast", &ToastEvent::Update {
                            msg: format!("업데이트 확인 중... ({})", version),
                            pct: None, done: false,
                        }).ok();
                        continue;
                    }
                }
                active.retain(|w| app.get_webview_window(&w.label).is_some());
                let label = format!("toast_{}", next_id); next_id += 1;
                if let Some(info) = create_window(&app, &log_path, &label,
                    ToastEvent::Update { msg: format!("업데이트 확인 중... ({})", version), pct: None, done: false },
                    active.len(), &data_dir)
                {
                    update_label = Some(label);
                    active.push(info);
                }
            }

            NotifyCmd::UpdateProgress { pct } => {
                if let Some(ref lbl) = update_label {
                    if let Some(win) = app.get_webview_window(lbl) {
                        win.emit("toast", &ToastEvent::Update {
                            msg: "다운로드 중...".into(), pct: Some(pct), done: false,
                        }).ok();
                    }
                }
            }

            NotifyCmd::UpdateStatus { msg } => {
                if let Some(ref lbl) = update_label {
                    if let Some(win) = app.get_webview_window(lbl) {
                        win.emit("toast", &ToastEvent::Update { msg, pct: None, done: false }).ok();
                    }
                }
            }

            NotifyCmd::UpdateDone => {
                if let Some(ref lbl) = update_label {
                    if let Some(win) = app.get_webview_window(lbl) {
                        win.emit("toast", &ToastEvent::Update {
                            msg: "업데이트 완료! 재시작합니다.".into(),
                            pct: Some(100), done: true,
                        }).ok();
                    }
                }
                update_label = None;
                // Toast.tsx가 2초 후 toast_closed → win.destroy() 호출
            }

            NotifyCmd::CancelUpdate => {
                if let Some(ref lbl) = update_label {
                    if let Some(win) = app.get_webview_window(lbl) {
                        // 직접 destroy 하지 않고 이벤트로 알림
                        // → Toast.tsx가 toast_closed → win.destroy() 처리 (reposition 포함)
                        win.emit("toast", &ToastEvent::UpdateCancelled).ok();
                    }
                }
                update_label = None;
            }

            NotifyCmd::WindowClosed { label } => {
                super::system::log(&log_path, &format!("notify: WindowClosed label={} active_before={}", label, active.len()));
                // 백엔드에서 실제 소멸 처리 (프론트는 win.hide()만 호출)
                if let Some(w) = app.get_webview_window(&label) {
                    let _ = w.destroy();
                }
                let Some(closed_idx) = active.iter().position(|w| w.label == label) else {
                    super::system::log(&log_path, &format!("notify: WindowClosed label={} NOT in active list", label));
                    continue
                };

                let delta = active[closed_idx].phys_h + active[closed_idx].phys_gap;
                active.remove(closed_idx);

                if active.len() <= closed_idx { continue; } // 위에 창 없음

                // 닫힌 창 위쪽에 있던 창들의 시작 위치 캡처
                let to_move: Vec<(String, i32, i32)> = active[closed_idx..].iter()
                    .map(|w| (w.label.clone(), w.x, w.y))
                    .collect();

                // 300ms 애니메이션으로 아래로 이동
                let steps = 15u32;
                for step in 1..=steps {
                    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                    for (lbl, x, start_y) in &to_move {
                        let t     = step as f64 / steps as f64;
                        let new_y = start_y + (delta as f64 * t) as i32;
                        if let Some(win) = app.get_webview_window(lbl) {
                            let _ = win.set_position(tauri::PhysicalPosition::new(*x, new_y));
                        }
                    }
                }

                // 추적 위치 갱신
                for (i, (_, _, start_y)) in to_move.iter().enumerate() {
                    active[closed_idx + i].y = start_y + delta;
                }
                super::system::log(&log_path, &format!("notify: WindowClosed done active_after={}", active.len()));
            }
        }
    }
}
