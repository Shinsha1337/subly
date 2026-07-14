import { defineConfig } from 'vitest/config';

// Separate from vite.config.js (which sets root:'src' for the UI build) so tests
// resolve from the Subly root and don't pull in the build-only icon plugin.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['test/**/*.test.{js,jsx}']
    }
});
