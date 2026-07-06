const {
  bindAdaptiveResize,
  loadPageData,
  clearPageLoadState,
  unbindAdaptiveResize
} = require('../../../utils/page-factory')
const {
  getDataManagementData,
  exportUserData,
  deleteUserData,
  clearUserAccount
} = require('../../../utils/api')

/**
 * 数据管理详情页。
 * 职责：展示数据摘要、多格式导出、数据删除和清空账号。
 */
Page({
  data: {
    isLoading: true,
    loadError: '',
    summary: [],
    dataScopes: [],
    exportOptions: [],
    exportFormat: 'json',
    formatOptions: [
      { key: 'json', label: 'JSON', desc: '结构化数据，适合技术处理' },
      { key: 'csv', label: 'CSV', desc: '表格格式，可用 Excel 打开' },
      { key: 'text', label: '文本', desc: '纯文本格式，便于阅读' }
    ],
    exporting: false,
    exportResult: '',
    showExportResult: false
  },

  async loadData() {
    return loadPageData(this, getDataManagementData)
  },

  async onLoad() {
    wx.setNavigationBarTitle({ title: '数据管理' })
    bindAdaptiveResize(this)
    await this.loadData()
  },

  onUnload() {
    unbindAdaptiveResize(this)
    if (this.route) clearPageLoadState(this.route)
    if (this._navTimer) { clearTimeout(this._navTimer); this._navTimer = null }
  },

  async reloadPage() {
    await this.loadData()
  },

  selectFormat(e) {
    this.setData({ exportFormat: e.currentTarget.dataset.key })
  },

  async handleExport() {
    const format = this.data.exportFormat
    const formatLabel = this.data.formatOptions.find(f => f.key === format)?.label || format
    wx.showModal({
      title: '导出数据',
      content: `将以 ${formatLabel} 格式导出全部健康数据，确认导出？`,
      success: async (res) => {
        if (!res.confirm) return
        this.setData({ exporting: true })
        try {
          const result = await exportUserData()
          let exportText = ''
          if (format === 'json') {
            const data = result.data || result
            exportText = JSON.stringify(data, null, 2)
          } else if (format === 'csv') {
            exportText = this._toCsvText(result)
          } else {
            exportText = result.exportText || JSON.stringify(result.data || result, null, 2)
          }
          this.setData({
            exporting: false,
            exportResult: exportText,
            showExportResult: true
          })
        } catch (err) {
          this.setData({ exporting: false })
          wx.showToast({ title: '导出失败', icon: 'none' })
        }
      }
    })
  },

  _toCsvText(result) {
    const data = result.data || result
    const lines = ['康小记数据导出（CSV 格式）', `导出时间：${result.generatedAt || new Date().toISOString()}`, '']
    const records = data.healthRecords || data.records || []
    if (records.length > 0) {
      lines.push('--- 健康记录 ---')
      lines.push('时间,类型,数值,场景,状态')
      records.forEach(r => {
        lines.push(`${r.time || ''},${r.type || ''},${r.value || ''},${r.tag || ''},${r.status || ''}`)
      })
      lines.push('')
    }
    const plans = data.medicationPlans || []
    if (plans.length > 0) {
      lines.push('--- 用药计划 ---')
      lines.push('药品名称,剂量,服药时间')
      plans.forEach(p => {
        const times = (p.times || []).join(';')
        lines.push(`${p.name || ''},${p.dosage || ''},${times}`)
      })
      lines.push('')
    }
    return lines.join('\n')
  },

  copyExportResult() {
    wx.setClipboardData({
      data: this.data.exportResult,
      success: () => {
        wx.showToast({ title: '已复制到剪贴板', icon: 'success' })
      }
    })
  },

  closeExportResult() {
    this.setData({ showExportResult: false, exportResult: '' })
  },

  async handleDeleteData(e) {
    const scope = e.currentTarget.dataset.scope
    const scopeLabel = scope === 'medication' ? '用药' : '健康'
    wx.showModal({
      title: `删除${scopeLabel}数据`,
      content: `确认删除所有${scopeLabel}数据？此操作不可恢复。`,
      confirmColor: '#c8463a',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中…' })
        try {
          await deleteUserData({ scope })
          wx.hideLoading()
          wx.showToast({ title: '删除完成', icon: 'success' })
          await this.loadData()
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      }
    })
  },

  handleClearAccount() {
    wx.showModal({
      title: '注销账号',
      content: '注销后，你的个人资料、健康记录、用药计划、家庭关系和授权日志将被清理，此操作不可恢复。',
      confirmColor: '#c8463a',
      success: async (res) => {
        if (!res.confirm) return
        wx.showModal({
          title: '二次确认',
          content: '注销账号后所有数据永久消失，确定执行？',
          confirmColor: '#c8463a',
          success: async (res2) => {
            if (!res2.confirm) return
            wx.showLoading({ title: '注销中…' })
            try {
              await clearUserAccount({ confirm: true })
              wx.hideLoading()
              wx.showToast({ title: '账号已注销', icon: 'success' })
              this._navTimer = setTimeout(() => {
                wx.reLaunch({ url: '/pages/launch/index' })
              }, 1500)
            } catch (err) {
              wx.hideLoading()
              wx.showToast({ title: '注销失败', icon: 'none' })
            }
          }
        })
      }
    })
  }
})
