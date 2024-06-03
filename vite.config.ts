import { resolve } from 'path'
import dts from "vite-plugin-dts";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
      include: ['src']
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es', 'cjs'],
      fileName: "index"
    },
    rollupOptions: {
      external: ['@nostr-dev-kit/ndk', 'nostr-tools', 'path-browserify'],

    },
  },
});
