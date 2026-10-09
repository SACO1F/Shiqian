use crate::{model::*, shell_target, AppState};
use serde_json::{json, Value};
use std::sync::{atomic::Ordering, mpsc};
use tauri::{Emitter, Manager};

pub fn open(app: &tauri::AppHandle, state: &AppState) -> Result<Value> {
    state.store()?.floating_presets()?;
    let settings = state.store()?.bootstrap()?["settings"].clone();
    let width = settings["floatingSize"]["width"]
        .as_f64()
        .unwrap_or(340.)
        .clamp(280., 900.);
    let height = settings["floatingSize"]["height"]
        .as_f64()
        .unwrap_or(460.)
        .clamp(320., 1000.);
    let topmost = settings["floatingAlwaysOnTop"].as_bool().unwrap_or(true);
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
        .inner_size(width, height)
        .min_inner_size(280., 320.)
        .max_inner_size(900., 1000.)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .effects(
            tauri::window::EffectsBuilder::new()
                .effect(tauri::window::Effect::Acrylic)
                .build(),
        )
        .always_on_top(topmost)
        .theme(match settings["theme"].as_str() {
            Some("dark") => Some(tauri::Theme::Dark),
            Some("light") => Some(tauri::Theme::Light),
            _ => None,
        })
        .skip_taskbar(true)
        .focused(true);
        if std::env::var_os("SHIQIAN_DATA_DIR").is_some() {
            builder = builder.data_directory(state.store()?.root.join("webview"));
        }
        let w = builder.build().map_err(|e| err("WINDOW_ERROR", e))?;
        remember_size(&w, state);
        if let Ok(Some(m)) = w.current_monitor() {
            let area = m.work_area();
            let scale = m.scale_factor();
            let fitted_height = height.min((area.size.height as f64 / scale - 80.).max(320.));
            let _ = w.set_size(tauri::LogicalSize::new(width, fitted_height));
            let x = area.position.x + area.size.width as i32 - ((width + 24.) * scale) as i32;
            let y = area.position.y + (60. * scale) as i32;
            let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
        }
    }
    let _ = app.emit("library-changed", ());
    Ok(json_ok())
}

fn remember_size(window: &tauri::WebviewWindow, state: &AppState) {
    let (sender, receiver) = mpsc::channel();
    let watched = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Resized(size) = event {
            if let Ok(scale) = watched.scale_factor() {
                let logical = size.to_logical::<f64>(scale);
                let _ = sender.send((logical.width.round() as u32, logical.height.round() as u32));
            }
        }
    });
    let state = state.clone();
    // One worker debounces native resize events, avoiding a database write per frame.
    std::thread::spawn(move || {
        while let Ok(mut size) = receiver.recv() {
            loop {
                match receiver.recv_timeout(std::time::Duration::from_millis(250)) {
                    Ok(next) => size = next,
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            if size.1 >= 320 {
                if let Ok(mut store) = state.store() {
                    let _ = store.save_settings(
                        &json!({"key":"floatingSize","value":{"width":size.0,"height":size.1}}),
                    );
                }
            }
        }
    });
}

pub fn options(app: &tauri::AppHandle) -> Result<Value> {
    let window = app
        .get_webview_window("floating")
        .ok_or_else(|| err("WINDOW_ERROR", "浮窗未打开"))?;
    let scale = window.scale_factor().map_err(|e| err("WINDOW_ERROR", e))?;
    let size = window
        .inner_size()
        .map_err(|e| err("WINDOW_ERROR", e))?
        .to_logical::<f64>(scale);
    Ok(
        json!({"width":size.width,"height":size.height,"collapsed":size.height<100.,"alwaysOnTop":window.is_always_on_top().map_err(|e| err("WINDOW_ERROR",e))?,"resizable":window.is_resizable().map_err(|e| err("WINDOW_ERROR",e))?}),
    )
}

pub fn resize(app: &tauri::AppHandle, state: &AppState, collapsed: bool) -> Result<Value> {
    let window = app
        .get_webview_window("floating")
        .ok_or_else(|| err("WINDOW_ERROR", "浮窗未打开"))?;
    let current = options(app)?;
    if collapsed && current["height"].as_f64().unwrap_or_default() >= 320. {
        state.store()?.save_settings(&json!({"key":"floatingSize","value":{"width":current["width"].as_f64().unwrap_or(340.).round() as u32,"height":current["height"].as_f64().unwrap_or(460.).round() as u32}}))?;
    }
    let settings = state.store()?.bootstrap()?["settings"].clone();
    let width = settings["floatingSize"]["width"].as_f64().unwrap_or(340.);
    let height = settings["floatingSize"]["height"].as_f64().unwrap_or(460.);
    window
        .set_min_size(Some(tauri::LogicalSize::new(
            280.,
            if collapsed { 64. } else { 320. },
        )))
        .map_err(|e| err("WINDOW_ERROR", e))?;
    window
        .set_resizable(!collapsed)
        .map_err(|e| err("WINDOW_ERROR", e))?;
    window
        .set_size(tauri::LogicalSize::new(
            width,
            if collapsed { 64. } else { height },
        ))
        .map_err(|e| err("WINDOW_ERROR", e))?;
    Ok(json_ok())
}

pub fn topmost(app: &tauri::AppHandle, state: &AppState, value: bool) -> Result<Value> {
    let window = app
        .get_webview_window("floating")
        .ok_or_else(|| err("WINDOW_ERROR", "浮窗未打开"))?;
    window
        .set_always_on_top(value)
        .map_err(|e| err("WINDOW_ERROR", e))?;
    state
        .store()?
        .save_settings(&json!({"key":"floatingAlwaysOnTop","value":value}))?;
    Ok(json_ok())
}

pub fn sync_theme(app: &tauri::AppHandle, theme: &str) -> Result<Value> {
    let theme = match theme {
        "dark" => tauri::Theme::Dark,
        "light" => tauri::Theme::Light,
        _ => return Err(err("INVALID_INPUT", "无效的窗口主题")),
    };
    for window in app.webview_windows().values() {
        window
            .set_theme(Some(theme))
            .map_err(|e| err("WINDOW_ERROR", e))?;
    }
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
