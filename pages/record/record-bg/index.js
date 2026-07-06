const { safeNavigateBack, loadPageData, clearPageLoadState, bindAdaptiveResize, unbindAdaptiveResize } = require('../../../utils/page-factory')
const { getRecordBgData, saveBloodGlucoseRecord } = require('../../../utils/api')
const { promptSubscribeAfterAction } = require('../../../utils/subscribe-prompt')
const routes = require('../../../utils/routes')

Page({
  data: {
    form: { glucose: '', note: '' },
    errors: {},
    mealTags: ['空腹', '餐前', '餐后', '睡前', '其他'],
    selectedMealTag: '空腹',
    measuredAt: '',
    summaryTip: '',
    summaryLevel: '',
    quickTimes: [
      { label: '现在', value: 'now' },
      { label: '空腹', value: '06:00' },
      { label: '餐后', value: 'afterMeal' },
      { label: '睡前', value: '21:00' }
    ],
    currentTime: '',
    afterMealTime: '',
    timeManuallySet: false,
    adaptive: {},
    isLoading: false,
    loadError: ''
  },

  async onLoad() {
    wx.setNavigationBarTitle({
      title: '血糖记录'
    })
    bindAdaptiveResize(this)
    await loadPageData(this, getRecordBgData)
    if (!this.data.measuredAt) {
      const now = new Date()
      const hours = String(now.getHours()).padStart(2, '0')
      const minutes = String(now.getMinutes()).padStart(2, '0')
      const afterMealDate = new Date(now.getTime() + 2 * 60 * 60 * 1000)
      const afterMealHours = String(afterMealDate.getHours()).padStart(2, '0')
      const afterMealMinutes = String(afterMealDate.getMinutes()).padStart(2, '0')
      this.setData({
        measuredAt: `${hours}:${minutes}`,
        currentTime: `${hours}:${minutes}`,
        afterMealTime: `${afterMealHours}:${afterMealMinutes}`
      })
    }
  },

  onUnload() {
    unbindAdaptiveResize(this)
    if (this.route) clearPageLoadState(this.route)
    if (this._navTimer) { clearTimeout(this._navTimer); this._navTimer = null }
  },

  async handleReload() {
    await loadPageData(this, getRecordBgData)
  },

  handleFormChange(event) {
    const { field } = event.currentTarget.dataset
    const value = event.detail.value
    
    this.setData({
      [`form.${field}`]: value
    })
    
    if (field === 'glucose') {
      this.validateField(field, value)
      this.updateSummary()
    }
  },

  handleMealTagSelect(event) {
    const tag = event.currentTarget.dataset.tag
    const updates = { selectedMealTag: tag }
    if (!this.data.timeManuallySet) {
      const timeMap = { '空腹': '06:00', '餐前': '11:30', '睡前': '21:00' }
      if (timeMap[tag]) {
        updates.measuredAt = timeMap[tag]
      } else if (tag === '餐后') {
        updates.measuredAt = this.data.afterMealTime || this.data.currentTime
      }
    }
    this.setData(updates)
  },

  handleQuickTime(event) {
    const value = event.currentTarget.dataset.value
    if (value === 'now') {
      const now = new Date()
      const hours = String(now.getHours()).padStart(2, '0')
      const minutes = String(now.getMinutes()).padStart(2, '0')
      this.setData({ measuredAt: `${hours}:${minutes}`, timeManuallySet: true })
    } else if (value === 'afterMeal') {
      this.setData({ measuredAt: this.data.afterMealTime || this.data.currentTime, timeManuallySet: true })
    } else {
      this.setData({ measuredAt: value, timeManuallySet: true })
    }
  },

  handleTimeChange(event) {
    const time = event.detail.value
    this.setData({
      measuredAt: time,
      timeManuallySet: true
    })
  },

  handlePickerCancel() {
    // picker 取消时的兜底处理，确保原生遮罩层正确回收
  },

  validateField(field, value) {
    const errors = { ...this.data.errors }
    
    if (field === 'glucose') {
      const num = parseFloat(value)
      if (value && (isNaN(num) || num < 1 || num > 35)) {
        errors.glucose = '血糖值应在 1-35 mmol/L 之间'
      } else {
        delete errors.glucose
      }
    }
    
    this.setData({ errors })
  },

  updateSummary() {
    const { glucose, selectedMealTag } = this.data.form
    const num = parseFloat(glucose)
    
    if (!glucose) {
      this.setData({ summaryTip: '', summaryLevel: '' })
      return
    }
    
    let tip = ''
    let level = ''
    const isFasting = selectedMealTag === '空腹' || selectedMealTag === '餐前'
    
    if (num >= 11.1) {
      tip = '血糖明显偏高，建议尽快就医检查'
      level = 'warn'
    } else if (isFasting && num >= 7.0) {
      tip = '空腹血糖偏高（达糖尿病标准），建议咨询医生'
      level = 'warn'
    } else if (!isFasting && num >= 7.8) {
      tip = '餐后血糖偏高，建议复测或咨询医生'
      level = 'warn'
    } else if (isFasting && num >= 6.1) {
      tip = '空腹血糖偏高（糖尿病前期），建议关注并定期测量'
      level = 'normal'
    } else if (!isFasting && num >= 7.8) {
      tip = '餐后血糖偏高，建议关注并定期测量'
      level = 'normal'
    } else if (num < 2.8) {
      tip = '血糖偏低，请注意身体状况，如有不适请就医'
      level = 'warn'
    } else if (num < 3.9) {
      tip = '血糖偏低，建议适当补充糖分'
      level = 'normal'
    } else {
      tip = '血糖正常'
      level = 'normal'
    }
    
    this.setData({ summaryTip: tip, summaryLevel: level })
  },

  async handleSave() {
    const { form, selectedMealTag, measuredAt } = this.data
    
    if (!form.glucose) {
      wx.showToast({
        title: '请填写血糖值',
        icon: 'none'
      })
      return
    }

    const glucose = parseFloat(form.glucose)
    const errors = {}

    if (isNaN(glucose) || glucose < 1 || glucose > 35) {
      errors.glucose = '血糖值应在 1-35 mmol/L 之间'
    }
    if (Object.keys(errors).length) {
      this.setData({ errors })
      return
    }
    
    if (!measuredAt) {
      wx.showToast({
        title: '请选择测量时间',
        icon: 'none'
      })
      return
    }
    
    this.setData({ isLoading: true })
    
    try {
      const payload = {
        glucose,
        tag: selectedMealTag,
        measuredAt,
        note: form.note
      }
      
      await saveBloodGlucoseRecord(payload)
      
      wx.showToast({
        title: '记录已保存',
        icon: 'success'
      })

      // 保存成功后，引导授权下次测量提醒（事件驱动，累积订阅次数）
      this._promptNextMeasureReminder()
      
      this._navTimer = setTimeout(() => {
        safeNavigateBack(routes.home)
      }, 800)
    } catch (error) {
      wx.showToast({
        title: error.message || '保存失败，请重试',
        icon: 'none'
      })
    } finally {
      try { this.setData({ isLoading: false }) } catch (e) { /* 页面可能已销毁 */ }
    }
  },

  /**
   * 引导授权下次测量提醒。
   * 事件驱动授权：用户完成血糖记录后，累积 1 次微信推送权限。
   * 防打扰：24 小时内同一场景只引导 1 次，拒绝后 7 天冷却。
   * @returns {void}
   */
  _promptNextMeasureReminder() {
    promptSubscribeAfterAction(['measure'], { scene: 'record-bg-saved' })
      .then(result => {
        if (result.ok) {
          wx.showToast({
            title: '已开启下次测量提醒',
            icon: 'success',
            duration: 1500
          })
        }
      })
      .catch(() => { /* 静默处理，不阻塞业务 */ })
  },

  handleCancel() {
    safeNavigateBack(routes.home)
  }
})
