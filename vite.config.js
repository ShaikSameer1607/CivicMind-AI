import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Load all environment variables available during the build
  const env = loadEnv(mode, process.cwd(), '');

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

  const missingVars = requiredVars.filter(
    (key) => !env[key] || env[key].trim() === ''
  );

  if (missingVars.length > 0) {
    console.error('\n❌ BUILD FAILED: Missing Required Environment Variables\n');
    console.error('The following variables must be provided during build:\n');

    missingVars.forEach((key) => {
      console.error(` - ${key}`);
    });

    console.error('\nAvailable VITE_* variables during build:\n');

    Object.keys(env)
      .filter((key) => key.startsWith('VITE_'))
      .forEach((key) => {
        console.error(` ✓ ${key}`);
      });

    console.error('\nPlease supply these as Cloud Build substitutions or Docker build arguments.\n');

    process.exit(1);
  }

  console.log('\n✅ Environment validation passed.\n');

  return {
    envPrefix: ['VITE_', 'GEMINI_', 'FIREBASE_'],
  };
});
