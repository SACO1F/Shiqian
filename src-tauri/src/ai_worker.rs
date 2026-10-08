use crate::{ai::*, db::Store, fsops, model::*};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

pub fn start_worker(
    shared_store: Arc<Mutex<Store>>,
    epoch: Arc<AtomicU64>,
    notify: impl Fn() + Send + 'static,
) {
    std::thread::spawn(move || loop {
        let selected = (|| -> Result<_> {
            let mut store = shared_store
                .lock()
                .map_err(|_| err("STORAGE_UNAVAILABLE", "资料库暂不可用"))?;
            let config = store.ai_config()?;
            if !config.enabled {
                return Ok(None);
            }
            let Some((file, token)) = store.take_ai_job()? else {
                return Ok(None);
            };
            // Capture credentials with the configuration under the same lock.
            // A settings change must never send a new key to an old endpoint.
            Ok(Some((
                config,
                store.root.clone(),
                file,
                token,
                store.tags()?,
                epoch.load(Ordering::SeqCst),
                read_key(&store.root),
            )))
        })();
        let Ok(Some((config, root, file, token, pool, generation, key))) = selected else {
            std::thread::sleep(Duration::from_millis(500));
            continue;
        };
        notify();
        let result = (|| -> Result<_> {
            let content = content(&root, &file)?;
            let body = request_body(&config, &file, &pool, content)?;
            // File content can change while extracting. Verify before sending it.
            let actual = fsops::inspect(Path::new(&file.path))?;
            if actual.revision != file.revision || actual.identity != file.identity {
                return Err(err("FILE_CHANGED", "提取期间文件已变化，请重新识别"));
            }
            if epoch.load(Ordering::SeqCst) != generation {
                return Err(err("AI_CANCELLED", "AI 设置已变化"));
            }
            let result = send(&config, &key?, &body)?;
            parse_response(&result, &pool, config.allow_new_tags)
        })();
        if let Ok(mut store) = shared_store.lock() {
            if epoch.load(Ordering::SeqCst) == generation {
                let result = result
                    .and_then(|choices| store.apply_ai(&file, token, &config.model, &choices));
                if let Err(e) = result {
                    // Don't turn a newer queued request into a failure from an older response.
                    if store
                        .ai_task(&file.id)
                        .ok()
                        .flatten()
                        .is_some_and(|j| j.updated_at == token && j.status == "running")
                    {
                        let status = if e.starts_with("AI_UNSUPPORTED") {
                            "unsupported"
                        } else {
                            "failed"
                        };
                        let _ = store.task_status(&file.id, token, status, &e);
                    }
                }
            }
        }
        notify();
    });
}
