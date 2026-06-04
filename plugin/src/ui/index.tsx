/**
 * UI iframe entry — mounts the Preact root.
 */

import { render } from "preact";
import { App } from "./app.tsx";

// Inject the keyframes for the loading spinner. Figma's plugin iframe can't
// load external stylesheets so we inline what we need.
const style = document.createElement("style");
style.textContent = `
  @keyframes poseidon-spin { to { transform: rotate(360deg); } }
`;
document.head.appendChild(style);

const root = document.getElementById("root");
if (!root) {
  throw new Error("Poseidon UI: #root not found");
}
render(<App />, root);
