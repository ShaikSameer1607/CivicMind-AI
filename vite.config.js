import { defineConfig } from 'vite';

function validateEnvPlugin() {
  return {
    name: 'validate-env',
    configResolved(config) {
      if (config.command !== 'build') return;
      
      const requiredVars = [
        'VITE_FIREBASE_API_KEY',
        'VITE_FIREBASE_AUTH_DOMAIN',
        'VITE_FIREBASE_PROJECT_ID',
        'VITE_FIREBASE_STORAGE_BUCKET',
        'VITE_FIREBASE_MESSAGING_SENDER_ID',
        'VITE_FIREBASE_APP_ID',
        'VITE_SUPABASE_URL',
        'VITE_SUPABASE_ANON_KEY',
        'VITE_GEMINI_API_KEY',
        'VITE_GROQ_API_KEY',
        'VITE_DEFAULT_AI_PROVIDER'
      ];
      
      const missingVars = requiredVars.filter(v => !config.env[v]);
      
      if (missingVars.length > 0) {
        console.error('\n❌ BUILD FAILED: Missing Required Environment Variables\n');
        console.error('The following variables must be provided during build:');
        missingVars.forEach(v => console.error(` - ${v}`));
        console.error('\nPlease supply these as build arguments or environment variables.\n');
        process.exit(1);
      }
    }
  };
}

/** Expose GEMINI_API_KEY and FIREBASE_STORAGE_ENABLED from .env to the client bundle. */
export default defineConfig({
  envPrefix: ['VITE_', 'GEMINI_', 'FIREBASE_'],
  plugins: [validateEnvPlugin()]
});
