import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

function portalRoutes(): Plugin {
  const rewrite = (request: { url?: string }, _response: unknown, next: () => void) => {
    const path = request.url?.split('?')[0];
    if (path && ['/connexion', '/dashboard', '/admin'].includes(path)) {
      request.url = '/portal.html';
    }
    next();
  };
  return {
    name: 'portal-routes',
    configureServer(server) { server.middlewares.use(rewrite); },
    configurePreviewServer(server) { server.middlewares.use(rewrite); },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const configured = ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'APP_ID'].every(key => Boolean(env[`VITE_FIREBASE_${key}`]));
  return {
    plugins: [portalRoutes(), react()],
    define: { __PORTAL_CONFIGURED__: JSON.stringify(configured) },
    build: {
      rollupOptions: {
        input: { site: resolve('index.html'), portal: resolve('portal.html') },
      },
    },
  };
});
