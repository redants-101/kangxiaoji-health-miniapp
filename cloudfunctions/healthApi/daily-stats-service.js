const DAY_MS = 24 * 60 * 60 * 1000
const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000

function getDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  const safeDate = Number.isFinite(date.getTime()) ? date : new Date()
  return new Date(safeDate.getTime() + CHINA_TIME_OFFSET_MS).toISOString().slice(0, 10)
}

function parseMeasuredDate(value) {
  if (!value) return null
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null

  const text = `${value}`.trim()
  const dayMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (dayMatch) {
    const [, year, month, day] = dayMatch
    const normalized = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00+08:00`
    const date = new Date(normalized)
    return Number.isFinite(date.getTime()) ? date : null
  }

  const date = new Date(text)
  return Number.isFinite(date.getTime()) ? date : null
}

function getRecordDateKey(record) {
  return getDateKey(parseMeasuredDate(record && record.measuredAt) || new Date())
}

function getDayStart(dayKey) {
  return new Date(`${dayKey}T00:00:00+08:00`)
}

function getStartDateKey(days) {
  return getDateKey(new Date(Date.now() - Math.max(days - 1, 0) * DAY_MS))
}

function safeDocPart(value) {
  return `${value || 'unknown'}`.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function createStatsDocId(prefix, openId, dayKey) {
  const suffix = dayKey ? `_${dayKey.replace(/-/g, '')}` : ''
  return `${prefix}_${safeDocPart(openId)}${suffix}`
}

function toNumber(value) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function getUpdatedCount(result) {
  if (!result || typeof result !== 'object') return undefined
  if (result.stats && typeof result.stats.updated === 'number') return result.stats.updated
  if (typeof result.updated === 'number') return result.updated
  if (typeof result.updatedCount === 'number') return result.updatedCount
  return undefined
}

function getDocData(result) {
  if (!result || !result.data) return null
  return Array.isArray(result.data) ? result.data[0] || null : result.data
}

function isDuplicateError(error) {
  const message = `${error && (error.errMsg || error.message || error)}`
  return /duplicate|already exists|E11000|document exists|已存在|重复/.test(message)
}

function normalizeCount(value) {
  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? count : 0
}

function createEmptyDailyStats(dayKey) {
  return {
    dayKey,
    recordCount: 0,
    bpCount: 0,
    bgCount: 0,
    bpSystolicTotal: 0,
    bpDiastolicTotal: 0,
    bgGlucoseTotal: 0
  }
}

function createEmptyRecordStats() {
  return {
    recordCount: 0,
    bpCount: 0,
    bgCount: 0,
    bpSystolicTotal: 0,
    bpDiastolicTotal: 0,
    bgGlucoseTotal: 0
  }
}

function addRecordToStats(stats, record) {
  if (!record || (record.type !== 'bp' && record.type !== 'bg')) return

  stats.recordCount += 1

  if (record.type === 'bp') {
    stats.bpCount += 1
    stats.bpSystolicTotal += toNumber(record.systolic)
    stats.bpDiastolicTotal += toNumber(record.diastolic)
  }

  if (record.type === 'bg') {
    stats.bgCount += 1
    stats.bgGlucoseTotal += toNumber(record.glucose)
  }
}

function buildIncrementData({ db, _, type, record, delta }) {
  const data = {
    recordCount: _.inc(delta),
    updatedAt: db.serverDate()
  }

  if (type === 'bp') {
    data.bpCount = _.inc(delta)
    data.bpSystolicTotal = _.inc(toNumber(record.systolic) * delta)
    data.bpDiastolicTotal = _.inc(toNumber(record.diastolic) * delta)
  }

  if (type === 'bg') {
    data.bgCount = _.inc(delta)
    data.bgGlucoseTotal = _.inc(toNumber(record.glucose) * delta)
  }

  return data
}

function buildSeedData({ db, type, record, dayKey }) {
  const isBp = type === 'bp'
  const isBg = type === 'bg'
  const data = {
    recordCount: 1,
    bpCount: isBp ? 1 : 0,
    bgCount: isBg ? 1 : 0,
    bpSystolicTotal: isBp ? toNumber(record.systolic) : 0,
    bpDiastolicTotal: isBp ? toNumber(record.diastolic) : 0,
    bgGlucoseTotal: isBg ? toNumber(record.glucose) : 0,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  }

  if (dayKey) {
    data.dayKey = dayKey
    data.dayStart = getDayStart(dayKey)
  }

  return data
}

function createDailyStatsService({ db, _, collections, logPerf = () => {} }) {
  const dailyCollection = collections.dailyStats
  const summaryCollection = collections.recordStats

  async function createStatsDocument(collectionName, docId, seedData, updateData, openId) {
    try {
      return await db.collection(collectionName).add({
        data: {
          _openid: openId,
          _id: docId,
          ...seedData
        }
      })
    } catch (error) {
      if (!isDuplicateError(error)) throw error
      return await db.collection(collectionName).doc(docId).update({ data: updateData })
    }
  }

  async function updateStatsDocument(collectionName, docId, updateData, seedData, delta, step, route = 'recordStats', openId) {
    if (!collectionName) return null
    const startedAt = Date.now()

    try {
      const result = await db.collection(collectionName).doc(docId).update({ data: updateData })
      const updatedCount = getUpdatedCount(result)
      if (updatedCount === 0 && delta > 0) {
        const createResult = await createStatsDocument(collectionName, docId, seedData, updateData, openId)
        logPerf({
          routeType: 'action',
          route,
          step: `${step}.create`,
          durationMs: Date.now() - startedAt,
          count: 1,
          ok: true
        })
        return createResult
      }

      logPerf({
        routeType: 'action',
        route,
        step: `${step}.update`,
        durationMs: Date.now() - startedAt,
        count: normalizeCount(updatedCount),
        ok: true
      })
      return result
    } catch (error) {
      if (delta > 0) {
        try {
          const createResult = await createStatsDocument(collectionName, docId, seedData, updateData, openId)
          logPerf({
            routeType: 'action',
            route,
            step: `${step}.createAfterMiss`,
            durationMs: Date.now() - startedAt,
            count: 1,
            ok: true
          })
          return createResult
        } catch (createError) {
          console.warn('预聚合统计写入失败:', createError)
        }
      } else {
        console.warn('预聚合统计扣减失败:', error)
      }

      logPerf({
        routeType: 'action',
        route,
        step,
        durationMs: Date.now() - startedAt,
        ok: false,
        error: error && (error.message || error.errMsg)
      })
      return null
    }
  }

  async function upsertAbsoluteStatsDocument(collectionName, docId, data, step, route = 'rebuildRecordStats', openId) {
    if (!collectionName) return null
    const startedAt = Date.now()

    try {
      const result = await db.collection(collectionName).doc(docId).update({ data })
      const updatedCount = getUpdatedCount(result)
      if (updatedCount === 0) {
        const createResult = await db.collection(collectionName).add({
          data: {
            _openid: openId,
            _id: docId,
            ...data,
            createdAt: db.serverDate()
          }
        })
        logPerf({
          routeType: 'action',
          route,
          step: `${step}.create`,
          durationMs: Date.now() - startedAt,
          count: 1,
          ok: true
        })
        return createResult
      }

      logPerf({
        routeType: 'action',
        route,
        step: `${step}.update`,
        durationMs: Date.now() - startedAt,
        count: normalizeCount(updatedCount),
        ok: true
      })
      return result
    } catch (error) {
      try {
        const createResult = await createStatsDocument(collectionName, docId, {
          ...data,
          createdAt: db.serverDate()
        }, data, openId)
        logPerf({
          routeType: 'action',
          route,
          step: `${step}.createAfterMiss`,
          durationMs: Date.now() - startedAt,
          count: 1,
          ok: true
        })
        return createResult
      } catch (createError) {
        console.warn('预聚合统计重建写入失败:', createError)
        logPerf({
          routeType: 'action',
          route,
          step,
          durationMs: Date.now() - startedAt,
          ok: false,
          error: createError && (createError.message || createError.errMsg)
        })
        return null
      }
    }
  }

  async function updateRecordStats(openId, type, record, delta = 1, route = 'recordStats') {
    if (type !== 'bp' && type !== 'bg') return null

    const dayKey = getRecordDateKey(record)
    const normalizedDelta = delta >= 0 ? 1 : -1
    const dailyDocId = createStatsDocId('daily', openId, dayKey)
    const summaryDocId = createStatsDocId('summary', openId)
    const dailyUpdateData = buildIncrementData({ db, _, type, record, delta: normalizedDelta })
    const summaryUpdateData = buildIncrementData({ db, _, type, record, delta: normalizedDelta })
    const dailySeedData = buildSeedData({ db, type, record, dayKey })
    const summarySeedData = buildSeedData({ db, type, record })

    return await Promise.all([
      updateStatsDocument(dailyCollection, dailyDocId, dailyUpdateData, dailySeedData, normalizedDelta, 'db.dailyStats', route, openId),
      updateStatsDocument(summaryCollection, summaryDocId, summaryUpdateData, summarySeedData, normalizedDelta, 'db.recordStats', route, openId)
    ])
  }

  async function getDailyStats(openId, dayKey = getDateKey()) {
    const startedAt = Date.now()
    const docId = createStatsDocId('daily', openId, dayKey)

    try {
      const result = await db.collection(dailyCollection).doc(docId).get()
      const data = getDocData(result)
      logPerf({
        routeType: 'key',
        route: 'home',
        step: 'db.dailyStats.get',
        durationMs: Date.now() - startedAt,
        count: data ? 1 : 0,
        ok: true
      })
      return data || createEmptyDailyStats(dayKey)
    } catch (error) {
      logPerf({
        routeType: 'key',
        route: 'home',
        step: 'db.dailyStats.get',
        durationMs: Date.now() - startedAt,
        count: 0,
        ok: false,
        error: error && (error.message || error.errMsg)
      })
      return createEmptyDailyStats(dayKey)
    }
  }

  async function getRecordStats(openId, route = 'home') {
    const startedAt = Date.now()
    const docId = createStatsDocId('summary', openId)

    try {
      const result = await db.collection(summaryCollection).doc(docId).get()
      const data = getDocData(result)
      logPerf({
        routeType: 'key',
        route,
        step: 'db.recordStats.get',
        durationMs: Date.now() - startedAt,
        count: data ? 1 : 0,
        ok: true
      })
      return data || createEmptyRecordStats()
    } catch (error) {
      logPerf({
        routeType: 'key',
        route,
        step: 'db.recordStats.get',
        durationMs: Date.now() - startedAt,
        count: 0,
        ok: false,
        error: error && (error.message || error.errMsg)
      })
      return createEmptyRecordStats()
    }
  }

  async function getHomeStats(openId) {
    const [dailyStats, recordStats] = await Promise.all([
      getDailyStats(openId),
      getRecordStats(openId)
    ])
    return { dailyStats, recordStats }
  }

  async function getRecentDailyStats(openId, days = 30) {
    const startedAt = Date.now()
    const startKey = getStartDateKey(days)

    try {
      const { data = [] } = await db.collection(dailyCollection)
        .where({
          _openid: openId,
          dayKey: _.gte(startKey)
        })
        .orderBy('dayKey', 'desc')
        .limit(days + 2)
        .get()

      logPerf({
        routeType: 'key',
        route: 'report',
        step: 'db.dailyStats.recent',
        durationMs: Date.now() - startedAt,
        count: data.length,
        ok: true
      })
      return data
    } catch (error) {
      logPerf({
        routeType: 'key',
        route: 'report',
        step: 'db.dailyStats.recent',
        durationMs: Date.now() - startedAt,
        count: 0,
        ok: false,
        error: error && (error.message || error.errMsg)
      })
      return []
    }
  }

  async function rebuildRecordStats(openId, options = {}) {
    // 管理端回填：openId 为空时自动扫描所有用户
    if (!openId) {
      // 使用 aggregate 显式投影 _openid（普通 get() 不返回此系统字段）
      const { list: allRecords = [] } = await db.collection(collections.records)
        .aggregate()
        .sort({ createdAt: -1 })
        .limit(1000)
        .end()

      // 按用户分组
      const userMap = new Map()
      allRecords.forEach(r => {
        const oid = r._openid || 'unknown'
        if (!userMap.has(oid)) userMap.set(oid, [])
        userMap.get(oid).push(r)
      })

      const results = []
      for (const [oid, records] of userMap) {
        results.push(await _rebuildSingleUser(oid, records, options))
      }
      return { users: userMap.size, details: results }
    }

    const limit = Math.min(Math.max(Number(options.limit) || 500, 1), 1000)
    const { data: records = [] } = await db.collection(collections.records)
      .where({ _openid: openId })
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get()

    return _rebuildSingleUser(openId, records, options)
  }

  async function _rebuildSingleUser(openId, records, options = {}) {
    logPerf({
      routeType: 'action',
      route: 'rebuildRecordStats',
      step: 'db.records.rebuildRead',
      count: records.length,
      ok: true
    })

    const recordStats = createEmptyRecordStats()
    const dailyStatsMap = new Map()

    records.forEach((record) => {
      addRecordToStats(recordStats, record)

      const dayKey = getRecordDateKey(record)
      if (!dailyStatsMap.has(dayKey)) {
        dailyStatsMap.set(dayKey, createEmptyDailyStats(dayKey))
      }
      addRecordToStats(dailyStatsMap.get(dayKey), record)
    })

    const dailyStatsList = Array.from(dailyStatsMap.values())
    const summaryDocId = createStatsDocId('summary', openId)
    const summaryData = {
      ...recordStats,
      rebuiltAt: db.serverDate(),
      updatedAt: db.serverDate()
    }

    const writeTasks = [
      upsertAbsoluteStatsDocument(summaryCollection, summaryDocId, summaryData, 'db.recordStats.rebuild', openId)
    ]

    dailyStatsList.forEach((dailyStats) => {
      writeTasks.push(upsertAbsoluteStatsDocument(dailyCollection, createStatsDocId('daily', openId, dailyStats.dayKey), {
        ...dailyStats,
        dayStart: getDayStart(dailyStats.dayKey),
        rebuiltAt: db.serverDate(),
        updatedAt: db.serverDate()
      }, 'db.dailyStats.rebuild', openId))
    })

    await Promise.all(writeTasks)

    return {
      openId: openId.slice(0, 8) + '***',
      recordCount: records.length,
      dailyStatCount: dailyStatsList.length
    }
  }

  return {
    getDateKey,
    getHomeStats,
    getRecordStats,
    getRecentDailyStats,
    rebuildRecordStats,
    updateRecordStats
  }
}

module.exports = {
  createDailyStatsService,
  getDateKey
}
