import type { Pool } from 'pg'

export type ApiRole = 'admin' | 'dispatcher' | 'driver' | 'customer'

export function createRoleClient(baseUrl: string, role: ApiRole, token: string) {
  return {
    role,
    request(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers)
      headers.set('authorization', `Bearer ${token}`)
      headers.set('content-type', 'application/json')
      return fetch(new URL(path, baseUrl), { ...init, headers })
    },
  }
}

export async function resetDatabase(database: Pool): Promise<void> {
  const { rows } = await database.query<{ tablename: string }>(
    `SELECT table_info.tablename
     FROM pg_tables AS table_info
     JOIN pg_class AS relation ON relation.relname = table_info.tablename
     JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE table_info.schemaname = 'public'
       AND table_info.tablename <> 'pgmigrations'
       AND namespace.nspname = table_info.schemaname
       AND relation.relkind IN ('r', 'p')
       AND NOT EXISTS (
         SELECT 1
         FROM pg_depend AS dependency
         WHERE dependency.classid = 'pg_class'::regclass
           AND dependency.objid = relation.oid
           AND dependency.deptype = 'e'
       )`,
  )
  if (rows.length === 0) return
  const tables = rows.map(({ tablename }) => `public."${tablename.replaceAll('"', '""')}"`)
  await database.query(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`)
}
