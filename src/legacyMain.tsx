import React from "react";
import type { Root } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./timelineMediaCompact.css";

export function mountLegacy(root: Root) {
  root.render(<React.StrictMode><App /></React.StrictMode>);
}
