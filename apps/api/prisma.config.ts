import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Migrations always run as the schema owner (`appraisal_migrator`), never as the runtime role.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('MIGRATOR_DATABASE_URL'),
  },
});
