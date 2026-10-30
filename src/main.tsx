import ReactDOM from "react-dom/client";
import { mountV2 } from "./v2/main";

// v2 is the only app. A legacy `?v2` query string is accepted and ignored so old links keep working.
mountV2(ReactDOM.createRoot(document.getElementById("root")!));
