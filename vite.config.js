import { defineConfig } from 'vite';

export default defineConfig({
  envPrefix: ['VITE_', 'GEMINI_', 'FIREBASE_'],
});
