import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from '@bolinha/core';
const client=new pg.Client({connectionString:config.DATABASE_URL});
try {
  await client.connect();
  const directory = resolve(import.meta.dirname, '../drizzle');
  for (const file of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort())
    await client.query(await readFile(resolve(directory, file), 'utf8'));
  console.info('Migrations applied');
} finally { await client.end(); }
