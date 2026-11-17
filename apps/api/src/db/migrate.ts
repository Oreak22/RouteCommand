import { fileURLToPath } from 'node:url'

import { runner } from 'node-pg-migrate'

import { env } from '../config/env.js'

const direction = process.argv[2]

if (direction !== 'up' && direction !== 'down') {
  console.error('Usage: npm run db:migrate | npm run db:rollback')
  process.exitCode = 2
} else {
  const migrationsDirectory = fileURLToPath(new URL('../../db/migrations/', import.meta.url))

  try {
    await runner({
      databaseUrl: env.DATABASE_URL,
      dir: migrationsDirectory,
      direction,
      migrationsTable: 'pgmigrations',
      migrationLoaderStrategies: [{ extensions: ['.sql'], loader: 'sql' }],
    })
  } catch (error) {
    console.error(
      `Database migration ${direction} failed:`,
      error instanceof Error ? error.message : 'Unknown error',
    )
    process.exitCode = 1
  }
}
