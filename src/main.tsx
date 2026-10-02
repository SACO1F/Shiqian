import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Floating from "./Floating";
import "./style.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {new URLSearchParams(location.search).has("floating") ? (
      <Floating />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
