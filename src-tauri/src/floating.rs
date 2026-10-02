use crate::{model::*, shell_target, AppState};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager};

pub fn open(app: &tauri::AppHandle, state: &AppState) -> Result<Value> {
    state.store()?.floating_presets()?;
    if let Some(w) = app.get_webview_window("floating") {
        w.show().map_err(|e| err("WINDOW_ERROR", e))?;
        w.set_focus().map_err(|e| err("WINDOW_ERROR", e))?;
    } else {
        let mut builder = tauri::WebviewWindowBuilder::new(
            app,
            "floating",
            tauri::WebviewUrl::App("index.html?floating".into()),
        )
        .title("拾签 · 标签浮窗")
        .inner_size(340., 460.)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(true);
        if std::env::var_os("SHIQIAN_DATA_DIR").is_some() {
            builder = builder.data_directory(state.store()?.root.join("webview"));
        }
        let w = builder.build().map_err(|e| err("WINDOW_ERROR", e))?;
        if let Ok(Some(m)) = w.current_monitor() {
            let area = m.work_area();
            let scale = m.scale_factor();
            let x = area.position.x + area.size.width as i32 - (364. * scale) as i32;
            let y = area.position.y + (60. * scale) as i32;
            let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
        }
    }
    let _ = app.emit("library-changed", ());
    Ok(json_ok())
}
pub fn main_show(app: &tauri::AppHandle) -> Result<Value> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    Ok(json_ok())
}
pub fn close(app: &tauri::AppHandle, state: &AppState) -> Result<Value> {
    state.drag_cancel.store(true, Ordering::Relaxed);
    if let Some(main) = app.get_webview_window("main") {
        if !main.is_visible().unwrap_or(false) {
            main_show(app)?;
        }
    }
    if let Some(w) = app.get_webview_window("floating") {
        let _ = w.hide();
    }
    Ok(json_ok())
}
pub fn finish(app: &tauri::AppHandle, result: Result<Value>) {
    let payload = match result {
        Ok(v) => json!({"ok":true,"result":v}),
        Err(e) => json!({"ok":false,"error":e}),
    };
    let _ = app.emit("annotation-result", payload);
    let _ = app.emit("tag-drag-end", ());
    let _ = app.emit("library-changed", ());
}
pub fn start_drag(app: &tauri::AppHandle, state: &AppState, tag_id: &str) -> Result<Value> {
    if !state.store()?.tags()?.iter().any(|t| t.id == tag_id) {
        return Err(err("TAG_NOT_FOUND", "标签已删除"));
    }
    if state.drag_active.swap(true, Ordering::SeqCst) {
        return Err(err("DRAG_BUSY", "正在拖动标签"));
    }
    state.drag_cancel.store(false, Ordering::Relaxed);
    let app = app.clone();
    let state = state.clone();
    let tid = tag_id.to_owned();
    std::thread::spawn(move || {
        #[cfg(windows)]
        {
            use windows::Win32::{
                Foundation::POINT,
                UI::{
                    Input::KeyboardAndMouse::{GetAsyncKeyState, VK_ESCAPE, VK_LBUTTON},
                    WindowsAndMessaging::{GetAncestor, GetCursorPos, WindowFromPoint, GA_ROOT},
                },
            };
            let started = std::time::Instant::now();
            loop {
                if state.drag_cancel.load(Ordering::Relaxed)
                    || started.elapsed().as_secs() > 60
                    || unsafe { GetAsyncKeyState(VK_ESCAPE.0 as i32) } < 0
                {
                    let _ = app.emit("tag-drag-end", ());
                    break;
                }
                let mut point = POINT::default();
                if unsafe { GetCursorPos(&mut point) }.is_err() {
                    finish(&app, Err(err("DRAG_FAILED", "无法读取鼠标位置")));
                    break;
                }
                let down = unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } < 0;
                let mut over_main = false;
                if let Some(w) = app.get_webview_window("main") {
                    if let (Ok(hwnd), Ok(origin), Ok(scale)) =
                        (w.hwnd(), w.inner_position(), w.scale_factor())
                    {
                        let root = unsafe { GetAncestor(WindowFromPoint(point), GA_ROOT) };
                        over_main = root.0 == hwnd.0;
                        let _=w.emit("tag-drag-point",json!({"tagId":tid,"x":(point.x-origin.x) as f64/scale,"y":(point.y-origin.y) as f64/scale,"over":over_main,"drop":!down}));
                    }
                }
                if !down {
                    if !over_main {
                        let result =
                            shell_target::file_at_point(point.x, point.y).and_then(|path| {
                                state
                                    .store()?
                                    .annotate(&json!({"tagId":tid,"paths":[path]}))
                            });
                        finish(&app, result);
                    } else {
                        let _ = app.emit("tag-drag-end", ());
                    }
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(32));
            }
        }
        #[cfg(not(windows))]
        finish(&app, Err(err("UNSUPPORTED", "请把文件拖到浮窗标签上")));
        state.drag_active.store(false, Ordering::SeqCst);
    });
    Ok(json_ok())
}
