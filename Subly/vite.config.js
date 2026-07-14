import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export default defineConfig({
    plugins: [
        react(),
        {
            name: 'copy-icon',
            closeBundle() {
                const distAssets = join(__dirname, 'dist', 'assets');
                mkdirSync(distAssets, { recursive: true });
                for (const name of ['Subly.ico', 'Subly.icns']) {
                    const src = join(__dirname, 'src', 'assets', name);
                    if (existsSync(src)) copyFileSync(src, join(distAssets, name));
                }
            }
        }
    ],
    root: 'src',
    build: {
        outDir: '../dist',
        emptyOutDir: true
    },
    base: './'
});
