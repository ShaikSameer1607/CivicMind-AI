import { defineConfig } from 'vite';

/** Expose GEMINI_API_KEY and FIREBASE_STORAGE_ENABLED from .env to the client bundle. */
export default defineConfig({
  envPrefix: ['VITE_', 'GEMINI_', 'FIREBASE_'],
});
