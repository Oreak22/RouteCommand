import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { closeDatabasePool, pool } from './pool.js'

const seedPath = fileURLToPath(new URL('../../db/seed.sql', import.meta.url))

try {
  const seedSql = await readFile(seedPath, 'utf8')
  await pool.query(seedSql)
  console.log('Development database seed applied.')
} catch (error) {
  console.error(
    'Development database seed failed:',
    error instanceof Error ? error.message : 'Unknown error',
  )
  process.exitCode = 1
} finally {
  await closeDatabasePool()
}
