/** Tiny floating link from the legacy app to the v2 editor (?v2). */
export function TryV2Link() {
  return (
    <a href="?v2" style={{ position: "fixed", right: 12, bottom: "max(12px, env(safe-area-inset-bottom))", zIndex: 9999, background: "#20d5ec", color: "#06161a", font: "600 12px system-ui", padding: "6px 12px", borderRadius: 999, textDecoration: "none", boxShadow: "0 2px 8px rgba(0,0,0,.35)" }}>
      Try new editor (v2)
    </a>
  );
}
