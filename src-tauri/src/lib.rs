mod ai;
mod ai_worker;
mod annotation;
#[cfg(test)]
mod auto_tag_tests;
mod auto_tags;
mod backup;
#[cfg(test)]
mod beta2_tests;
mod db;
mod floating;
mod fsops;
mod model;
mod shell_target;
mod support;
mod tag_export;
#[cfg(test)]
mod tests;
mod transfer;
#[cfg(test)]
mod transfer_tests;
mod window_geometry;

use crate::{db::Store, model::*};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone)]
pub struct AppState {
    store: Arc<Mutex<Store>>,
    jobs: Arc<Mutex<HashMap<String, (ImportJob, Arc<AtomicBool>)>>>,
    drag_active: Arc<AtomicBool>,
    drag_cancel: Arc<AtomicBool>,
    ai_generation: Arc<AtomicU64>,
    transfer: Arc<transfer::Control>,
}
impl AppState {
    fn new(root: &Path) -> Result<Self> {
        Ok(Self {
            store: Arc::new(Mutex::new(Store::open(root)?)),
            jobs: Arc::new(Mutex::new(HashMap::new())),
            drag_active: Arc::new(AtomicBool::new(false)),
            drag_cancel: Arc::new(AtomicBool::new(false)),
            ai_generation: Arc::new(AtomicU64::new(0)),
            transfer: Arc::new(transfer::Control::default()),
        })
    }
    fn store(&self) -> Result<std::sync::MutexGuard<'_, Store>> {
        self.store
            .lock()
            .map_err(|_| err("INTERNAL_ERROR", "资料库锁异常，请重启"))
    }
    fn blocks_exit(&self) -> bool {
        self.transfer.busy.load(Ordering::SeqCst)
            || self
                .jobs
                .lock()
                .map(|jobs| jobs.values().any(|(job, _)| !job.done))
                .unwrap_or(true)
    }
    fn start_import(&self, app: tauri::AppHandle, v: &Value) -> Result<Value> {
        if self.transfer.busy.load(Ordering::SeqCst) {
            return Err(err("TRANSFER_BUSY", "请等待当前资料包或恢复任务完成"));
        }
        let paths = string_list(v, "paths");
        if paths.is_empty() {
            return Err(err("INVALID_INPUT", "请选择文件或文件夹"));
        }
        let recursive = v["recursive"].as_bool().unwrap_or(true);
        let jid = id();
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut jobs = self
                .jobs
                .lock()
                .map_err(|_| err("INTERNAL_ERROR", "任务锁异常"))?;
            if jobs.values().any(|(j, _)| !j.done) {
                return Err(err("IMPORT_BUSY", "已有加入任务正在进行"));
            }
            jobs.clear();
            jobs.insert(
                jid.clone(),
                (
                    ImportJob {
                        id: jid.clone(),
                        ..Default::default()
                    },
                    cancel.clone(),
                ),
            );
        }
        let state = self.clone();
        let thread_id = jid.clone();
        std::thread::spawn(move || {
            let mut progress = ImportJob {
                id: thread_id.clone(),
                ..Default::default()
            };
            let root = state.store().map(|s| s.root.clone()).unwrap_or_default();
            let mut stack: Vec<(PathBuf, usize)> =
                paths.into_iter().map(|p| (PathBuf::from(p), 0)).collect();
            let mut visited = std::collections::HashSet::new();
            while let Some((path, depth)) = stack.pop() {
                if cancel.load(Ordering::Relaxed) {
                    progress.cancelled = true;
                    break;
                }
                let outcome = (|| -> Result<()> {
                    let meta =
                        std::fs::symlink_metadata(&path).map_err(|e| err("ACCESS_DENIED", e))?;
                    if fsops::is_link(&meta) || fsops::is_hidden(&meta) {
                        progress.skipped += 1;
                        return Ok(());
                    }
                    let canonical = fsops::canonical_display(&path)?;
                    if Path::new(&canonical).starts_with(&root) {
                        progress.skipped += 1;
                        return Ok(());
                    }
                    if !visited.insert(canonical.clone()) {
                        progress.skipped += 1;
                        return Ok(());
                    }
                    if meta.is_dir() {
                        if depth > 0 && !recursive {
                            progress.skipped += 1;
                            return Ok(());
                        }
                        for entry in
                            std::fs::read_dir(&canonical).map_err(|e| err("ACCESS_DENIED", e))?
                        {
                            match entry {
                                Ok(e) => stack.push((e.path(), depth + 1)),
                                Err(e) => {
                                    progress.failed += 1;
                                    if progress.errors.len() < 100 {
                                        progress.errors.push(format!("{}：{e}", path.display()));
                                        progress.failed_paths.push(canonical.clone());
                                    }
                                }
                            }
                        }
                    } else if meta.is_file() {
                        progress.discovered += 1;
                        let m = fsops::inspect(Path::new(&canonical))?;
                        let added = state.store()?.add_file(&m)?;
                        if added {
                            progress.added += 1;
                        } else {
                            progress.existing += 1;
                        }
                        progress.processed += 1;
                    } else {
                        progress.skipped += 1;
                    }
                    Ok(())
                })();
                if let Err(e) = outcome {
                    progress.failed += 1;
                    progress.processed += 1;
                    if progress.errors.len() < 100 {
                        progress.errors.push(format!("{}：{e}", path.display()));
                        progress.failed_paths.push(path.to_string_lossy().into());
                    }
                }
                if let Ok(mut jobs) = state.jobs.lock() {
                    if let Some((j, _)) = jobs.get_mut(&thread_id) {
                        *j = progress.clone();
                    }
                }
                if progress.processed % 50 == 0 {
                    let _ = app.emit("import-progress", &progress);
                }
            }
            progress.done = true;
            if let Ok(mut jobs) = state.jobs.lock() {
                if let Some((j, _)) = jobs.get_mut(&thread_id) {
                    *j = progress.clone();
                }
            }
            let _ = app.emit("import-progress", &progress);
            let _ = app.emit("library-changed", ());
        });
        Ok(json!({"id":jid}))
    }
    fn refresh_all(&self, app: tauri::AppHandle) -> Result<Value> {
        let paths = self.store()?.all_paths()?;
        let state = self.clone();
        std::thread::spawn(move || {
            for (i, (fid, _)) in paths.iter().enumerate() {
                if let Ok(mut s) = state.store() {
                    let _ = s.refresh_file(fid);
                }
                if i % 100 == 0 {
                    let _ = app.emit("library-changed", ());
                }
            }
            let _ = app.emit("library-changed", ());
        });
        Ok(json_ok())
    }
}

fn dispatch(state: &AppState, app: &tauri::AppHandle, action: &str, v: &Value) -> Result<Value> {
    match action {
        "ai.settings" => state.store()?.ai_settings(),
        "ai.settings.save" => {
            let mut store = state.store()?;
            let result = store.save_ai_settings(v)?;
            state.ai_generation.fetch_add(1, Ordering::SeqCst);
            Ok(result)
        }
        "ai.test" => {
            let (config, key) = {
                let s = state.store()?;
                (s.ai_config()?, ai::read_key(&s.root)?)
            };
            ai::test_connection(config, &key)
        }
        "ai.enqueue" => {
            let store = state.store()?;
            if !store.ai_config()?.enabled {
                return Err(err(
                    "AI_NOT_ENABLED",
                    "请先在偏好设置配置并启用 AI 自动标注",
                ));
            }
            store.queue_ai(&string_list(v, "ids"))?;
            Ok(json_ok())
        }
        "ai.retry_failed" => {
            let store = state.store()?;
            store.retry_failed_ai()
        }
        "tasks.status" => {
            let import = state
                .jobs
                .lock()
                .map_err(|_| err("INTERNAL_ERROR", "任务锁异常"))?
                .values()
                .next()
                .map(|(job, _)| job.clone());
            Ok(
                json!({"transfer":state.transfer.status(),"import":import,"ai":state.store()?.ai_summary()?}),
            )
        }
        "support.status" => state.store()?.support_snapshot(),
        "diagnostics.preview" | "diagnostics.export" => {
            let snapshot = state.store()?.support_snapshot()?;
            let text = support::diagnostic_report(&snapshot, &state.transfer.status());
            if action == "diagnostics.export" {
                support::export_report(Path::new(str_arg(v, "path")?), &text)
            } else {
                Ok(json!({"text":text}))
            }
        }
        "recovery.dismiss" => {
            let mut store = state.store()?;
            store
                .conn
                .execute("DELETE FROM settings WHERE key='recoveryNotice'", [])
                .map_err(sql_err)?;
            store.recovery_notice.clear();
            Ok(json_ok())
        }
        "ai.cancel" => {
            let store = state.store()?;
            if v.get("ids").is_some() {
                return store.cancel_ai_files(&string_list(v, "ids"));
            }
            state.ai_generation.fetch_add(1, Ordering::SeqCst);
            store.conn.execute("UPDATE ai_jobs SET status='cancelled',error='已取消，可重新识别' WHERE status IN ('queued','running')",[]).map_err(sql_err)?;
            Ok(json_ok())
        }
        "ai.confirm" => state.store()?.confirm_ai(v),
        "folders.apply" => state.store()?.fill_folder_tags(),
        "floating.open" => floating::open(app, state),
        "floating.close" => floating::close(app, state),
        "floating.presets" => state.store()?.floating_presets(),
        "floating.save" => state.store()?.save_floating_presets(&string_list(v, "ids")),
        "floating.state" => floating::options(app),
        "floating.resize" => floating::resize(
            app,
            state,
            v["collapsed"]
                .as_bool()
                .ok_or_else(|| err("INVALID_INPUT", "缺少收起状态"))?,
        ),
        "floating.topmost" => floating::topmost(
            app,
            state,
            v["value"]
                .as_bool()
                .ok_or_else(|| err("INVALID_INPUT", "缺少置顶状态"))?,
        ),
        "theme.sync" => floating::sync_theme(app, str_arg(v, "theme")?),
        "floating.drag" => floating::start_drag(app, state, str_arg(v, "tagId")?),
        "floating.cancel" => {
            state.drag_cancel.store(true, Ordering::Relaxed);
            Ok(json_ok())
        }
        "annotation.apply" => {
            let result = state.store()?.annotate(v);
            floating::finish(app, result.clone());
            result
        }
        "annotation.reject" => {
            floating::finish(app, Err(err("DROP_TARGET", "请把标签放到具体文件卡片上")));
            Ok(json_ok())
        }
        "main.show" => floating::main_show(app),
        "main.close" => {
            if state.transfer.busy.load(Ordering::SeqCst) {
                return Err(err("TRANSFER_BUSY", "后台任务尚未完成，请等待或取消后退出"));
            }
            if state.blocks_exit() {
                return Err(err("IMPORT_BUSY", "加入任务尚未停止，请等待清理完成后退出"));
            }
            floating::save_geometry(app, state);
            if app
                .get_webview_window("floating")
                .is_some_and(|w| w.is_visible().unwrap_or(false))
            {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            } else {
                app.exit(0);
            }
            Ok(json_ok())
        }
        "import" => state.start_import(app.clone(), v),
        "import.status" => {
            let jobs = state
                .jobs
                .lock()
                .map_err(|_| err("INTERNAL_ERROR", "任务锁异常"))?;
            Ok(json!(jobs.values().next().map(|(j, _)| j.clone())))
        }
        "import.cancel" => {
            if let Ok(jobs) = state.jobs.lock() {
                for (_, cancel) in jobs.values() {
                    cancel.store(true, Ordering::Relaxed);
                }
            }
            Ok(json_ok())
        }
        "refresh" => state.refresh_all(app.clone()),
        "preview" => {
            let (f, root) = {
                let mut s = state.store()?;
                let f = s.refresh_file(str_arg(v, "id")?)?;
                (f, s.root.clone())
            };
            fsops::preview(&root, &f, v["large"].as_bool().unwrap_or(false))
        }
        "preview.cache" => {
            let s = state.store()?;
            let f = s.file(str_arg(v, "id")?)?;
            if v["revision"].as_str() != Some(&f.revision) {
                return Err(err("FILE_CHANGED", "文件版本已变化"));
            }
            fsops::store_pdf_preview(
                &s.root,
                &f,
                v["large"].as_bool().unwrap_or(false),
                str_arg(v, "data")?,
            )
        }
        "files.open" | "files.reveal" => {
            let f = state.store()?.refresh_file(str_arg(v, "id")?)?;
            if action == "files.reveal" {
                fsops::reveal(&f.path)?;
            } else {
                if f.status != "available" {
                    return Err(err("FILE_UNAVAILABLE", f.error));
                }
                open::that(&f.path).map_err(|e| err("OPEN_FAILED", e))?;
            }
            Ok(json_ok())
        }
        "data.reveal" => {
            open::that(state.store()?.root.clone()).map_err(|e| err("OPEN_FAILED", e))?;
            Ok(json_ok())
        }
        "package.status" => Ok(state.transfer.status()),
        "package.cancel" => {
            if state.transfer.status()["task"]["kind"] == "backup.restore" {
                return Err(err("TRANSFER_BUSY", "恢复已开始，请等待完成"));
            }
            state.transfer.cancel.store(true, Ordering::SeqCst);
            Ok(json_ok())
        }
        "package.plan" => Ok(state.store()?.transfer_plan(v)?.info),
        "package.inspect" => state.transfer.run_named("package.inspect", || {
            transfer::preview(Path::new(str_arg(v, "path")?), &state.transfer)
        }),
        "package.export" => state.transfer.run_named("package.export", || {
            let plan = state.store()?.transfer_plan(v)?;
            transfer::export(
                plan,
                Path::new(str_arg(v, "path")?),
                str_arg(v, "fingerprint")?,
                &state.transfer,
            )
        }),
        "package.import" => state.transfer.run_named("package.import", || {
            if state
                .jobs
                .lock()
                .map_err(|_| err("INTERNAL_ERROR", "任务锁异常"))?
                .values()
                .any(|(j, _)| !j.done)
            {
                return Err(err("IMPORT_BUSY", "请先等待文件加入任务完成"));
            }
            transfer::import_shared(
                &state.store,
                Path::new(str_arg(v, "path")?),
                Path::new(str_arg(v, "destination")?),
                str_arg(v, "fingerprint")?,
                &state.transfer,
            )
        }),
        "backup.inspect" => {
            let root = state.store()?.root.clone();
            Ok(backup::inspect_backup(Path::new(str_arg(v, "path")?), &root)?.info)
        }
        "bootstrap" => state.store()?.bootstrap(),
        "query" => {
            let q: Query =
                serde_json::from_value(v.clone()).map_err(|e| err("INVALID_INPUT", e))?;
            state.store()?.query(&q)
        }
        "file" => Ok(json!(state.store()?.file(str_arg(v, "id")?)?)),
        "tags.export" => {
            let plan = state.store()?.tag_export_plan(str_arg(v, "id")?)?;
            tag_export::export(plan, Path::new(str_arg(v, "destination")?))
        }
        "export.reveal" => {
            let path = Path::new(str_arg(v, "path")?);
            if !path.is_dir() {
                return Err(err("EXPORT_DESTINATION", "导出文件夹已不存在"));
            }
            open::that(path).map_err(|e| err("OPEN_FAILED", e))?;
            Ok(json_ok())
        }
        "tag.create" => Ok(json!(state
            .store()?
            .create_workspace_tag(str_arg(v, "name")?)?)),
        "note.save" => state.store()?.save_note(v),
        "settings.save" => state.store()?.save_settings(v),
        "files.tags" | "files.favorite" | "files.remove" | "tags.rename" | "tags.delete" => {
            state.store()?.mutate(action, v)
        }
        "files.relink" => state.store()?.relink(v),
        "undo" => state.store()?.undo_last(),
        "cache.clear" => state.store()?.clear_cache(),
        "backup.export" => state.store()?.export_backup(Path::new(str_arg(v, "path")?)),
        "backup.restore" => state.transfer.run_named("backup.restore", || {
            if state
                .jobs
                .lock()
                .map_err(|_| err("INTERNAL_ERROR", "任务锁异常"))?
                .values()
                .any(|(j, _)| !j.done)
            {
                return Err(err("IMPORT_BUSY", "请等待加入任务完成或取消后再恢复"));
            }
            let mut store = state.store()?;
            state.ai_generation.fetch_add(1, Ordering::SeqCst);
            store.restore_backup(Path::new(str_arg(v, "path")?))
        }),
        _ => Err(err("UNKNOWN_ACTION", action)),
    }
}
#[tauri::command]
async fn api(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    action: String,
    payload: Option<Value>,
) -> Result<Value> {
    let state = state.inner().clone();
    let payload = payload.unwrap_or(json!({}));
    tauri::async_runtime::spawn_blocking(move || {
        let result = dispatch(&state, &app, &action, &payload);
        if result.is_ok()
            && matches!(
                action.as_str(),
                "tag.create"
                    | "tags.rename"
                    | "tags.delete"
                    | "files.tags"
                    | "files.remove"
                    | "files.favorite"
                    | "undo"
                    | "settings.save"
                    | "floating.save"
                    | "floating.topmost"
                    | "floating.resize"
                    | "folders.apply"
                    | "ai.settings.save"
                    | "ai.enqueue"
                    | "ai.retry_failed"
                    | "ai.cancel"
                    | "ai.confirm"
                    | "backup.restore"
                    | "package.import"
                    | "recovery.dismiss"
                    | "backup.export"
            )
        {
            let _ = app.emit("library-changed", ());
        }
        result
    })
    .await
    .map_err(|e| err("INTERNAL_ERROR", e))?
}
pub fn run() {
    let mut context = tauri::generate_context!();
    // An explicit library directory also isolates WebView state for testing or
    // managed deployments. Normal installations use the OS app-data directory.
    if let Some(root) = std::env::var_os("SHIQIAN_DATA_DIR") {
        // An isolated library must not activate a user's already-running normal
        // instance. Keep the single-instance lock scoped to its data directory.
        use sha2::{Digest, Sha256};
        let absolute = std::path::absolute(root).expect("Invalid SHIQIAN_DATA_DIR");
        let digest = format!(
            "{:x}",
            Sha256::digest(absolute.to_string_lossy().to_lowercase().as_bytes())
        );
        context.config_mut().identifier = format!("local.shiqian.isolated.{}", &digest[..16]);
        for window in &mut context.config_mut().app.windows {
            window.create = false;
        }
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app,_,_|{if let Some(w)=app.get_webview_window("main"){let _=w.unminimize();let _=w.show();let _=w.set_focus();}}))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app|{
            let root=std::env::var_os("SHIQIAN_DATA_DIR").map(PathBuf::from).unwrap_or(app.path().app_data_dir()?);
            let state=match AppState::new(&root){Ok(state)=>state,Err(error)=>{
                app.dialog().message(format!("资料库无法打开，已停止写入。\n\n{error}\n\n数据目录：{}\n请保留该目录与备份；如果提示版本过新，请使用创建该库的较新版本。",root.display())).title("拾签 · 资料库不可用").kind(tauri_plugin_dialog::MessageDialogKind::Error).blocking_show();
                app.handle().exit(1);return Ok(());
            }};app.manage(state.clone());
            if std::env::var_os("SHIQIAN_DATA_DIR").is_some(){
                for config in &app.config().app.windows {tauri::WebviewWindowBuilder::from_config(app,config)?.data_directory(root.join("webview")).build()?;}
            }
            let ai_app=app.handle().clone();
            ai_worker::start_worker(state.store.clone(),state.ai_generation.clone(),move || {let _=ai_app.emit("library-changed",());});
            let _=state.refresh_all(app.handle().clone());Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if let Some(state) = window.app_handle().try_state::<AppState>() {
                    if window.label() == "main" && state.blocks_exit() {
                        api.prevent_close();
                        let _ = window.emit("exit-blocked", ());
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![api])
        .build(context).expect("拾签启动失败")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if let Some(state) = app.try_state::<AppState>() {
                    if state.blocks_exit() {
                        api.prevent_exit();
                        let _ = app.emit("exit-blocked", ());
                    } else {
                        floating::save_geometry(app, &state);
                    }
                }
            }
        });
}
