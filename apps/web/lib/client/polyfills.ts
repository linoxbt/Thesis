import { Buffer } from "buffer";

// Anchor and spl-token expect a global Buffer in the browser.
if (typeof globalThis.Buffer === "undefined") {
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}
