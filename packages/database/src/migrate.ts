import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from '@bolinha/core';
const client=new pg.Client({connectionString:config.DATABASE_URL});
try { await client.connect(); await client.query(await readFile(resolve(import.meta.dirname,'../drizzle/0000_initial.sql'),'utf8')); console.info('Migrations applied'); } finally { await client.end(); }
