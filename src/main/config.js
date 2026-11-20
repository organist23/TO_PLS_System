import fs from 'node:fs';

// Values already in process.env win over the file (Node's loadEnvFile behavior).
export function loadConfig(envPath) {
  if (envPath && fs.existsSync(envPath)) process.loadEnvFile(envPath);
  const env = process.env;
  return {
    host: env.DB_HOST ?? 'localhost',
    port: Number(env.DB_PORT ?? 3306),
    user: env.DB_USER ?? 'root',
    password: env.DB_PASSWORD ?? '',
    database: env.DB_NAME ?? 'pls_to',
  };
}
