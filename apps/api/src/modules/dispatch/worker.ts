import { logger } from '../../core/logger.js'
import { requeueTimedOutAssignments } from '../shipments/index.js'

const intervalMs = 15_000

export async function startDispatchTimeoutWorker(): Promise<() => void> {
  let running = false
  let stopped = false
  const processTimeouts = async () => {
    if (running || stopped) return
    running = true
    try {
      const count = await requeueTimedOutAssignments()
      if (count > 0)
        logger.info({ count }, 'Timed-out shipment assignments returned to dispatch queue')
    } catch (error) {
      logger.error({ err: error }, 'Dispatch timeout check failed')
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void processTimeouts(), intervalMs)
  timer.unref()
  void processTimeouts()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
