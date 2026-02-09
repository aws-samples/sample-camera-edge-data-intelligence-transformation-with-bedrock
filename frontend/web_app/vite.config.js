import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true, // Docker対応
    watch: {
      usePolling: true, // Docker対応（ホットリロード）
    },
  },
  build: {
    outDir: 'build', // CRAと同じ出力先
    sourcemap: false,
  },
  // 環境変数のプレフィックス設定
  envPrefix: 'VITE_',
  // CRAからの移行: .jsファイルでもJSXを許可
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.js$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
    },
  },
});

