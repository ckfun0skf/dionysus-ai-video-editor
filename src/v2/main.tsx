import React from "react";
import type { Root } from "react-dom/client";
import { V2App } from "./ui/V2App";
import "./ui/v2.css";

export function mountV2(root: Root) {
  document.title = "Dionysus v2 — Timeline Editor";
  root.render(<React.StrictMode><V2App /></React.StrictMode>);
}
