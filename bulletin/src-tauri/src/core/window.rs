use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};

#[derive(Debug, Clone, PartialEq)]
pub enum Page {
    Unknown,
    Notices,
    Chat,
    Calendar,
    Admin,
}

impl Page {
    pub fn from_str(s: &str) -> Self {
        match s {
            "notices"  => Self::Notices,
            "chat"     => Self::Chat,
            "calendar" => Self::Calendar,
            "admin"    => Self::Admin,
            _          => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone)]
pub enum WindowStatus {
    Tray,
    Visible { monitor: Option<String>, page: Page },
}

pub struct WindowState {
    visible: AtomicBool,
    page:    Mutex<Page>,
    monitor: Mutex<Option<String>>,
}

impl WindowState {
    pub fn new() -> Self {
        Self {
            visible: AtomicBool::new(false),
            page:    Mutex::new(Page::Unknown),
            monitor: Mutex::new(None),
        }
    }

    pub fn set_visible(&self, visible: bool) {
        self.visible.store(visible, Ordering::Relaxed);
    }

    pub fn is_visible(&self) -> bool {
        self.visible.load(Ordering::Relaxed)
    }

    pub fn set_page(&self, page: Page) {
        if let Ok(mut p) = self.page.lock() { *p = page; }
    }

    pub fn get_page(&self) -> Page {
        self.page.lock().ok().map(|p| p.clone()).unwrap_or(Page::Unknown)
    }

    pub fn set_monitor(&self, name: Option<String>) {
        if let Ok(mut m) = self.monitor.lock() { *m = name; }
    }

    pub fn get_monitor(&self) -> Option<String> {
        self.monitor.lock().ok().and_then(|m| m.clone())
    }

    pub fn status(&self) -> WindowStatus {
        if !self.is_visible() {
            return WindowStatus::Tray;
        }
        WindowStatus::Visible {
            monitor: self.get_monitor(),
            page:    self.get_page(),
        }
    }

    /// 채팅 토스트를 표시해야 하는지
    /// → 창이 숨김이거나, 보이더라도 채팅 화면이 아닌 경우
    pub fn should_notify_chat(&self) -> bool {
        match self.status() {
            WindowStatus::Tray => true,
            WindowStatus::Visible { page, .. } => page != Page::Chat,
        }
    }
}
