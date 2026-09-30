import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In dev, point /api at the gateway (e.g. `API_URL=http://localhost:8090 npm run dev`
// to reuse the running compose stack).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    proxy: { "/api": process.env.API_URL ?? "http://localhost:8090" },
  },
});
