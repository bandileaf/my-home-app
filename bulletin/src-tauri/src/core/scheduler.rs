use std::future::Future;
use std::pin::Pin;
use tokio::sync::mpsc;
use tauri::async_runtime;

fn fmt_ms(ms: u64) -> String {
    if ms < 1000 { return format!("{}ms", ms); }
    let s = ms as f64 / 1000.0;
    if ms % 1000 == 0 { format!("{}s", ms / 1000) } else { format!("{:.1}s", s) }
}

// ── 내부 ticket ───────────────────────────────────────────────────────────────

struct Ticket {
    label:    String,
    delay_ms: u64,
    run:      Box<dyn FnOnce() -> Pin<Box<dyn Future<Output = ()> + Send + 'static>> + Send + 'static>,
}

// ── 공개 핸들 ─────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct Scheduler {
    tx:       mpsc::Sender<Ticket>,
    log_path: String,
}

impl Scheduler {
    /// `label` 식별자로 `delay_ms` 후에 `f` 를 실행하는 ticket 발행.
    pub fn after<F, Fut>(&self, label: &str, delay_ms: u64, f: F)
    where
        F:   FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        super::system::log(&self.log_path, &format!("sched: enqueue label={} delay={}", label, fmt_ms(delay_ms)));
        let _ = self.tx.try_send(Ticket {
            label:    label.to_string(),
            delay_ms,
            run:      Box::new(move || Box::pin(f())),
        });
    }
}

// ── 팩토리 ────────────────────────────────────────────────────────────────────

pub fn create(log_path: String) -> Scheduler {
    let (tx, mut rx) = mpsc::channel::<Ticket>(256);
    let log_path_loop = log_path.clone();

    async_runtime::spawn(async move {
        while let Some(ticket) = rx.recv().await {
            let log = log_path_loop.clone();
            async_runtime::spawn(async move {
                if ticket.delay_ms > 0 {
                    tokio::time::sleep(std::time::Duration::from_millis(ticket.delay_ms)).await;
                }
                super::system::log(&log, &format!("sched: run label={}", ticket.label));
                (ticket.run)().await;
            });
        }
    });

    Scheduler { tx, log_path }
}
