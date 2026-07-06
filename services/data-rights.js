const {
  STORAGE_KEYS,
  clearCloudReadCache,
  clearMemoryStorage,
  getRelatedCacheKeys,
  readStorage,
  removeStorage,
  resolveRemote,
  writeStorage,
  writeStorageAndInvalidate
} = require('./core')

const EXPORT_VERSION = '2026-04-27'

function getLocalDataSnapshot() {
  return {
    profile: readStorage(STORAGE_KEYS.profile, null),
    records: readStorage(STORAGE_KEYS.records, []),
    medicationPlans: readStorage(STORAGE_KEYS.medicationPlans, []),
    medicationConfirmations: readStorage(STORAGE_KEYS.medicationConfirmations, []),
    familyAuth: readStorage(STORAGE_KEYS.familyAuth, null),
    reminderSettings: readStorage(STORAGE_KEYS.reminderSettings, null),
    privacySettings: readStorage(STORAGE_KEYS.privacySettings, null),
    feedbacks: readStorage(STORAGE_KEYS.feedbacks, [])
  }
}

function toExportText(exportData) {
  return [
    '康小记个人数据导出',
    `导出时间：${exportData.generatedAt}`,
    `导出版本：${exportData.version}`,
    '',
    JSON.stringify(exportData.data, null, 2)
  ].join('\n')
}

function exportUserDataLocal() {
  const exportData = {
    version: EXPORT_VERSION,
    generatedAt: new Date().toISOString(),
    format: 'json',
    data: getLocalDataSnapshot()
  }
  return {
    ...exportData,
    exportText: toExportText(exportData)
  }
}

function deleteUserDataLocal(payload = {}) {
  const scope = payload.scope || 'health'
  if (scope === 'medication') {
    writeStorageAndInvalidate(STORAGE_KEYS.medicationPlans, [], getRelatedCacheKeys(STORAGE_KEYS.medicationPlans))
    writeStorageAndInvalidate(STORAGE_KEYS.medicationConfirmations, [], getRelatedCacheKeys(STORAGE_KEYS.medicationConfirmations))
    return { scope, deleted: true }
  }

  // scope=health：删除健康记录和用药确认记录（用药确认属于健康数据的一部分）
  writeStorageAndInvalidate(STORAGE_KEYS.records, [], getRelatedCacheKeys(STORAGE_KEYS.records))
  writeStorageAndInvalidate(STORAGE_KEYS.medicationConfirmations, [], getRelatedCacheKeys(STORAGE_KEYS.medicationConfirmations))
  return { scope, deleted: true }
}

function clearUserAccountLocal() {
  Object.keys(STORAGE_KEYS).forEach((key) => {
    removeStorage(STORAGE_KEYS[key])
  })
  // 清除云缓存和内存缓存，防止注销后残留旧数据
  clearCloudReadCache()
  clearMemoryStorage()
  return {
    cleared: true,
    clearedAt: new Date().toISOString()
  }
}

function exportUserData(payload = {}) {
  return resolveRemote('exportUserData', payload, exportUserDataLocal)
}

function deleteUserData(payload = {}) {
  return resolveRemote('deleteUserData', payload, deleteUserDataLocal, {
    mirrorLocal: true
  })
}

function clearUserAccount(payload = {}) {
  return resolveRemote('clearUserAccount', payload, clearUserAccountLocal, {
    mirrorLocal: true
  })
}

module.exports = {
  clearUserAccount,
  clearUserAccountLocal,
  deleteUserData,
  deleteUserDataLocal,
  exportUserData,
  exportUserDataLocal,
  getLocalDataSnapshot,
  toExportText
}
