import React from "react";
import type { Root } from "react-dom/client";
import App from "./App";
import { TryV2Link } from "./v2/ui/TryV2Link";
import "./styles.css";
import "./timelineMediaCompact.css";

export function mountLegacy(root: Root) {
  root.render(<React.StrictMode><App /><TryV2Link /></React.StrictMode>);
}
