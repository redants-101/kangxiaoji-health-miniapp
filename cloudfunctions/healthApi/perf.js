const PERF_LOG_PREFIX = '[healthApi:perf:v1]'

function getResultCount(result) {
  if (!result) return undefined
  if (Array.isArray(result)) {
    const count = result.reduce((total, item) => total + (getResultCount(item) || 0), 0)
    return count || undefined
  }
  if (Array.isArray(result.data)) return result.data.length
  if (typeof result.total === 'number') return result.total
  if (result.stats && typeof result.stats.updated === 'number') return result.stats.updated
  if (typeof result.updated === 'number') return result.updated
  if (typeof result.inserted === 'number') return result.inserted
  if (result._id) return 1
  return undefined
}

function normalizePerfInfo(info = {}) {
  return {
    schemaVersion: 1,
    event: 'healthApi.perf',
    timestamp: new Date().toISOString(),
    routeType: info.routeType || 'unknown',
    route: info.route || 'unknown',
    step: info.step || 'unknown',
    durationMs: Number.isFinite(Number(info.durationMs)) ? Number(info.durationMs) : 0,
    count: Number.isFinite(Number(info.count)) ? Number(info.count) : undefined,
    ok: info.ok !== false,
    error: info.error || undefined
  }
}

function createPerfLogger(logger = console) {
  function logPerf(info) {
    const payload = normalizePerfInfo(info)
    try {
      logger.log(PERF_LOG_PREFIX, JSON.stringify(payload))
    } catch (error) {
      logger.log(PERF_LOG_PREFIX, payload)
    }
  }

  async function withPerfLog(meta, task) {
    const startedAt = Date.now()
    try {
      const result = await task()
      logPerf({
        ...meta,
        durationMs: Date.now() - startedAt,
        count: getResultCount(result),
        ok: true
      })
      return result
    } catch (error) {
      logPerf({
        ...meta,
        durationMs: Date.now() - startedAt,
        ok: false,
        error: error.message || error.errMsg || `${error}`
      })
      throw error
    }
  }

  return {
    getResultCount,
    logPerf,
    withPerfLog
  }
}

module.exports = {
  createPerfLogger,
  getResultCount,
  normalizePerfInfo,
  PERF_LOG_PREFIX
}
