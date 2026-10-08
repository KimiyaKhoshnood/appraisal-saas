/**
 * One-time, idempotent cluster bootstrap (needs a superuser connection):
 *
 *   appraisal_migrator  LOGIN, owns the schema, runs migrations.
 *   app_runtime         NOLOGIN group role that migrations GRANT privileges to.
 *   appraisal_app       LOGIN member of app_runtime: what the API connects as.
 *                       Not an owner, NOBYPASSRLS, NOSUPERUSER (NF-03, T14).
 *
 * Usage: tsx scripts/db-bootstrap.ts            (main + test databases)
 */
import 'dotenv/config';
import { Client } from 'pg';

function parse(url: string | undefined, name: string): URL {
  if (!url) throw new Error(`${name} is not set`);
  return new URL(url);
}

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Unsafe identifier: ${s}`);
  return `"${s}"`;
};
const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;

async function main() {
  const superUrl = parse(process.env.POSTGRES_SUPERUSER_URL, 'POSTGRES_SUPERUSER_URL');
  const migrator = parse(process.env.MIGRATOR_DATABASE_URL, 'MIGRATOR_DATABASE_URL');
  const runtime = parse(process.env.DATABASE_URL, 'DATABASE_URL');
  const databases = [
    migrator.pathname.slice(1),
    process.env.TEST_DATABASE_NAME ?? 'appraisal_test',
    process.env.BENCH_DATABASE_NAME ?? 'appraisal_bench', // experiments E2–E6
  ];

  const client = new Client({ connectionString: superUrl.toString() });
  await client.connect();
  try {
    const migratorUser = decodeURIComponent(migrator.username);
    const runtimeUser = decodeURIComponent(runtime.username);

    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN
        CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
      END IF;
    END $$;`);

    for (const [user, pass, extra] of [
      [migratorUser, decodeURIComponent(migrator.password), 'CREATEDB'],
      [runtimeUser, decodeURIComponent(runtime.password), 'NOCREATEDB'],
    ] as const) {
      const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [user]);
      const verb = exists.rowCount ? 'ALTER' : 'CREATE';
      await client.query(
        `${verb} ROLE ${ident(user)} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE ${extra} PASSWORD ${literal(pass)}`,
      );
    }
    await client.query(`GRANT app_runtime TO ${ident(runtimeUser)}`);

    for (const db of databases) {
      const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
      if (!exists.rowCount) {
        await client.query(`CREATE DATABASE ${ident(db)} OWNER ${ident(migratorUser)}`);
        console.log(`created database ${db}`);
      }
      const dbClient = new Client({ connectionString: Object.assign(new URL(superUrl), { pathname: `/${db}` }).toString() });
      await dbClient.connect();
      try {
        // PostgreSQL 15+ no longer grants CREATE on public to everyone; make the migrator own it.
        await dbClient.query(`ALTER SCHEMA public OWNER TO ${ident(migratorUser)}`);
        await dbClient.query(`REVOKE ALL ON SCHEMA public FROM PUBLIC`);
        await dbClient.query(`GRANT USAGE ON SCHEMA public TO app_runtime`);
        await dbClient.query(`GRANT CONNECT ON DATABASE ${ident(db)} TO app_runtime`);
      } finally {
        await dbClient.end();
      }
    }
    console.log(`bootstrap ok: roles ${migratorUser}, app_runtime, ${runtimeUser}; databases ${databases.join(', ')}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
