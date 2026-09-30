import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true },
  // `npm run dev:web` + `npm run dev` (wrangler) di port 8787
  server: { proxy: { "/api": "http://localhost:8787" } },
});
