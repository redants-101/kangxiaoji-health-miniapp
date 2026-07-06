const {
  STORAGE_KEYS,
  createRecordId,
  readStorage,
  resolveMockData,
  resolveRemote,
  writeStorage
} = require('./core')
const { deepMerge, withMockPageData } = require('./page-data')

/**
 * 帮助与反馈服务模块。
 * 负责帮助中心数据、反馈页数据和本地反馈保存。
 */

/**
 * 本地提交反馈。
 * @param {Object} payload 反馈表单。
 * @param {string} payload.type 反馈类型。
 * @param {string} payload.content 反馈内容。
 * @param {string} [payload.contact] 联系方式。
 * @returns {Object} 保存后的反馈记录。
 */
function submitFeedbackLocal(payload) {
  const feedback = {
    id: payload.id || createRecordId('feedback'),
    type: payload.type,
    content: payload.content,
    contact: payload.contact || '',
    createdAt: new Date().toISOString()
  }
  const list = readStorage(STORAGE_KEYS.feedbacks, [])
  writeStorage(STORAGE_KEYS.feedbacks, [feedback, ...list])
  return feedback
}

/** @returns {Promise<Object>} 帮助中心数据。 */
function getHelpData() {
  return resolveMockData('help')
    .then((remoteData) => withMockPageData('help', remoteData, (baseData, remote) => deepMerge(baseData, remote)))
}

/** @returns {Promise<Object>} 意见反馈页数据。 */
function getFeedbackData() {
  return resolveMockData('feedback')
    .then((remoteData) => withMockPageData('feedback', remoteData, (baseData, remote) => deepMerge(baseData, remote)))
}

/**
 * 提交意见反馈入口，按配置切换 local/cloud/http。
 * @param {Object} payload 反馈表单。
 * @returns {Promise<Object>} 保存结果。
 */
function submitFeedback(payload) {
  return resolveRemote('submitFeedback', payload, submitFeedbackLocal, {
    mirrorLocal: true
  })
}

module.exports = {
  getFeedbackData,
  getHelpData,
  submitFeedback
}
