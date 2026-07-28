import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Nur fuer die reinen Textpruefungen unter lib/email-quality gedacht: die
// laufen ohne DOM, deshalb kein jsdom und keine Testing-Library. Der Alias
// spiegelt "paths" aus tsconfig.json, damit Imports in Tests und App gleich
// aussehen.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
