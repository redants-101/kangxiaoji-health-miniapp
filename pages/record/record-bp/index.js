const { safeNavigateBack, loadPageData, clearPageLoadState, bindAdaptiveResize, unbindAdaptiveResize } = require('../../../utils/page-factory')
const { getRecordBpData, saveBloodPressureRecord } = require('../../../utils/api')
const { promptSubscribeAfterAction } = require('../../../utils/subscribe-prompt')
const routes = require('../../../utils/routes')
Page({
  data: {
    form: { systolic: '', diastolic: '', pulse: '', note: '' },
    errors: {},
    tags: ['晨起', '睡前', '运动后', '其他'],
    selectedTag: '晨起',
    measuredAt: '',
    summaryTip: '',
    summaryLevel: '',
    quickTimes: [
      { label: '现在', value: 'now' },
      { label: '晨起', value: '06:00' },
      { label: '睡前', value: '21:00' }
    ],
    currentTime: '',
    timeManuallySet: false,
    adaptive: {},
    isLoading: false,
    loadError: ''
  },

  async onLoad() {
    wx.setNavigationBarTitle({
      title: '血压记录'
    })
    bindAdaptiveResize(this)
    await loadPageData(this, getRecordBpData)
    if (!this.data.measuredAt) {
      const now = new Date()
      const hours = String(now.getHours()).padStart(2, '0')
      const minutes = String(now.getMinutes()).padStart(2, '0')
      this.setData({
        measuredAt: `${hours}:${minutes}`,
        currentTime: `${hours}:${minutes}`
      })
    }
  },

  onUnload() {
    unbindAdaptiveResize(this)
    if (this.route) clearPageLoadState(this.route)
    if (this._navTimer) { clearTimeout(this._navTimer); this._navTimer = null }
  },

  async handleReload() {
    await loadPageData(this, getRecordBpData)
  },

  handleFormChange(event) {
    const { field } = event.currentTarget.dataset
    const value = event.detail.value
    
    this.setData({
      [`form.${field}`]: value
    })
    
    this.validateField(field, value)
    this.updateSummary()
  },

  handleTagSelect(event) {
    const tag = event.currentTarget.dataset.tag
    const updates = { selectedTag: tag }
    if (!this.data.timeManuallySet) {
      const timeMap = { '晨起': '06:00', '睡前': '21:00' }
      if (timeMap[tag]) {
        updates.measuredAt = timeMap[tag]
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
    
    if (field === 'systolic') {
      const num = parseInt(value, 10)
      if (value && (isNaN(num) || num < 50 || num > 260)) {
        errors.systolic = '收缩压（高压）应在 50-260 mmHg 之间'
      } else {
        delete errors.systolic
      }
    }
    
    if (field === 'diastolic') {
      const num = parseInt(value, 10)
      if (value && (isNaN(num) || num < 30 || num > 160)) {
        errors.diastolic = '舒张压（低压）应在 30-160 mmHg 之间'
      } else {
        delete errors.diastolic
      }
    }
    
    this.setData({ errors })
  },

  updateSummary() {
    const { systolic, diastolic } = this.data.form
    const sys = parseInt(systolic, 10)
    const dia = parseInt(diastolic, 10)
    
    if (!systolic || !diastolic || isNaN(sys) || isNaN(dia)) {
      this.setData({ summaryTip: '', summaryLevel: '' })
      return
    }
    
    let tip = ''
    let level = ''
    
    // 参考 AHA/ACC 2023 指南 + 中国高血压防治指南
    // 注意：高血压各期用"或"（任一达标即归类），正常和低血压需综合判断
    if (sys >= 180 || dia >= 120) {
      // 高血压危象：收缩压≥180 或 舒张压≥120
      tip = '血压严重偏高，请尽快就医'
      level = 'warn'
    } else if (sys >= 140 || dia >= 90) {
      // 高血压：收缩压≥140 或 舒张压≥90
      if (sys >= 160 || dia >= 100) {
        tip = '血压偏高（2级高血压），建议咨询医生'
      } else {
        tip = '血压偏高（1级高血压），建议复测或咨询医生'
      }
      level = 'warn'
    } else if (sys >= 130 || dia >= 80) {
      // 血压升高：收缩压130-139 或 舒张压80-89（AHA 高血压1期 / 中国正常高值）
      tip = '血压偏高，建议关注并定期测量'
      level = 'normal'
    } else if (sys >= 120 && dia < 80) {
      // AHA Elevated：收缩压120-129 且 舒张压<80
      tip = '血压正常高值，建议关注并定期测量'
      level = 'normal'
    } else if (sys < 90 || dia < 60) {
      // 低血压：收缩压<90 或 舒张压<60
      tip = '血压偏低，请注意身体状况'
      level = 'warn'
    } else {
      // 正常：收缩压90-119 且 舒张压60-79
      tip = '血压正常'
      level = 'normal'
    }
    
    this.setData({ summaryTip: tip, summaryLevel: level })
  },

  async handleSave() {
    const { form, selectedTag, measuredAt } = this.data
    
    if (!form.systolic || !form.diastolic) {
      wx.showToast({
        title: '请填写收缩压（高压）和舒张压（低压）',
        icon: 'none'
      })
      return
    }

    const sys = parseInt(form.systolic, 10)
    const dia = parseInt(form.diastolic, 10)
    const errors = {}

    if (isNaN(sys) || sys < 50 || sys > 260) {
      errors.systolic = '收缩压（高压）应在 50-260 mmHg 之间'
    }
    if (isNaN(dia) || dia < 30 || dia > 160) {
      errors.diastolic = '舒张压（低压）应在 30-160 mmHg 之间'
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
        systolic: sys,
        diastolic: dia,
        pulse: form.pulse ? parseInt(form.pulse, 10) : null,
        tag: selectedTag,
        measuredAt,
        note: form.note
      }
      
      await saveBloodPressureRecord(payload)
      
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
   * 事件驱动授权：用户完成血压记录后，累积 1 次微信推送权限。
   * 防打扰：24 小时内同一场景只引导 1 次，拒绝后 7 天冷却。
   * @returns {void}
   */
  _promptNextMeasureReminder() {
    promptSubscribeAfterAction(['measure'], { scene: 'record-bp-saved' })
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
