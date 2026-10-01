import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',  // bind IPv4 loopback: Chrome resolves localhost to 127.0.0.1, not ::1
    port: 3100,
    // Fail if the port is taken instead of quietly moving to the next one;
    // a silent move is how this app ended up mistaken for another on :3000.
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
