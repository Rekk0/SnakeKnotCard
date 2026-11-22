import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/noto-sans-sc";
import "./styles.css";
import App from "./App";
import LegalGate from "./Legal";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LegalGate><App /></LegalGate>
  </React.StrictMode>,
);
