import { Pool, type QueryResult, type QueryResultRow } from 'pg'

import { env } from '../config/env.js'

export interface DatabaseExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

export type AfterCommitHandler = () => void | Promise<void>
export type RegisterAfterCommit = (handler: AfterCommitHandler) => void

interface Queryable {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
  statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
  application_name: 'routecommand-api',
})

pool.on('error', (error: NodeJS.ErrnoException & { code?: string }) => {
  console.error('Unexpected error from an idle PostgreSQL client', {
    code: error.code,
  })
})

function createExecutor(queryable: Queryable): DatabaseExecutor {
  return {
    async query<Row extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: unknown[],
    ): Promise<QueryResult<Row>> {
      const startedAt = performance.now()

      try {
        const result = await queryable.query<Row>(text, values)

        if (env.NODE_ENV === 'development') {
          console.debug('PostgreSQL query completed', {
            durationMs: Number((performance.now() - startedAt).toFixed(2)),
            rowCount: result.rowCount,
          })
        }

        return result
      } catch (error) {
        if (env.NODE_ENV === 'development') {
          console.debug('PostgreSQL query failed', {
            durationMs: Number((performance.now() - startedAt).toFixed(2)),
            code: error instanceof Error && 'code' in error ? String(error.code) : undefined,
          })
        }

        throw error
      }
    },
  }
}

const database = createExecutor(pool)

export const query = database.query

export async function withTransaction<Result>(
  callback: (client: DatabaseExecutor, afterCommit: RegisterAfterCommit) => Promise<Result>,
): Promise<Result> {
  const client = await pool.connect()
  const transaction = createExecutor(client)
  const afterCommitHandlers: AfterCommitHandler[] = []
  let releaseError: Error | undefined
  let result: Result

  try {
    await transaction.query('BEGIN')
    result = await callback(transaction, (handler) => afterCommitHandlers.push(handler))
    await transaction.query('COMMIT')
  } catch (error) {
    try {
      await transaction.query('ROLLBACK')
    } catch (rollbackError) {
      releaseError =
        rollbackError instanceof Error
          ? rollbackError
          : new Error('PostgreSQL transaction rollback failed.')
      throw new AggregateError(
        [error, rollbackError],
        'The database transaction failed and could not be rolled back.',
      )
    }

    throw error
  } finally {
    client.release(releaseError)
  }

  for (const handler of afterCommitHandlers) {
    try {
      await handler()
    } catch (error) {
      console.error('A post-commit handler failed.', {
        code: error instanceof Error && 'code' in error ? String(error.code) : undefined,
      })
    }
  }

  return result
}

export async function checkDatabaseHealth(): Promise<void> {
  await query('SELECT 1')
}

export async function closeDatabasePool(): Promise<void> {
  await pool.end()
}
