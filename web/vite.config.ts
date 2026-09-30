import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  // Chunk 3D (three.js) memang besar, tapi hanya dimuat di halaman Kantor 3D.
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1100 },
  // `npm run dev:web` + `npm run dev` (wrangler) di port 8787
  server: { proxy: { "/api": "http://localhost:8787" } },
});
