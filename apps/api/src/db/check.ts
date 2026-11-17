import { closeDatabasePool, query } from './pool.js'

try {
  const result = await query<{
    database_name: string
    postgis_version: string
  }>('SELECT current_database() AS database_name, postgis_full_version() AS postgis_version')

  console.log('PostgreSQL/PostGIS connection is healthy.')
  console.log(`Database: ${result.rows[0]?.database_name ?? 'unknown'}`)
  console.log(`PostGIS: ${result.rows[0]?.postgis_version ?? 'unknown'}`)
} catch (error) {
  console.error(
    'PostgreSQL/PostGIS health check failed:',
    error instanceof Error ? error.message : 'Unknown error',
  )
  process.exitCode = 1
} finally {
  await closeDatabasePool()
}
