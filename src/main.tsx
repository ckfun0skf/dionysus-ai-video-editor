import ReactDOM from "react-dom/client";

const root = ReactDOM.createRoot(document.getElementById("root")!);

// The v2 editor is opt-in via ?v2 and ships as a separate chunk; the legacy app is unchanged.
if (new URLSearchParams(window.location.search).has("v2")) {
  void import("./v2/main").then(({ mountV2 }) => mountV2(root));
} else {
  void import("./legacyMain").then(({ mountLegacy }) => mountLegacy(root));
}
