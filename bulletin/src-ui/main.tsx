import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ToastApp } from "./Toast";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const label = getCurrentWebviewWindow().label;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {label.startsWith("toast_") ? <ToastApp /> : <App />}
  </React.StrictMode>,
);
