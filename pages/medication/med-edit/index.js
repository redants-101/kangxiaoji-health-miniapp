const {
  bindAdaptiveResize,
  goRoute,
  loadPageData,
  clearPageLoadState,
  unbindAdaptiveResize
} = require('../../../utils/page-factory')
const { runButtonAction } = require('../../../utils/button-state')
const { getMedEditData, saveMedicationPlan } = require('../../../utils/api')
const { requestSubscription, isTemplateConfigured, DEV_MODE } = require('../../../utils/subscribe')
const { formatDisplayDate, formatDisplayDateWithYear, getTodayDateValue, normalizeDateValue } = require('../../../utils/date-helper')

function sortTimes(times, confirmedSet) {
  return times.slice().sort((left, right) => left.value.localeCompare(right.value)).map(item => ({
    ...item,
    isConfirmed: confirmedSet ? confirmedSet.has(item.value) : false
  }))
}

Page({
  data: {
    isLoading: true,
    loadError: '',
    errors: {},
    pendingAction: '',
    sourcePlanId: '',
    startDateValue: '',
    startDateLabel: '',
    endDateValue: '',
    endDateLabel: '',
    timePickerValue: '08:00',
    editingTimeIndex: -1,
    isDirty: false,
    confirmedTimes: []
  },

  async loadData(planId) {
    let data
    try {
      data = await loadPageData(this, () => getMedEditData(planId))
    } catch (error) {
      // loadPageData 内部已处理 isLoading/loadError，此处兜底防崩溃
      console.error('[med-edit] loadData failed:', error)
      return null
    }
    if (!data) return null

    // 防御性校验：确保 data.form 存在，避免后续解构崩溃
    const form = data.form || {}
    let startDateValue, endDateValue
    try {
      startDateValue = normalizeDateValue(form.startDate, getTodayDateValue())
      endDateValue = form.endDate ? normalizeDateValue(form.endDate, '') : ''
    } catch (error) {
      console.error('[med-edit] normalizeDateValue failed:', error)
      startDateValue = getTodayDateValue()
      endDateValue = ''
    }

    const confirmedTimes = Array.isArray(data.confirmedTimes) ? data.confirmedTimes : []
    const confirmedSet = new Set(confirmedTimes)
    const sortedTimes = sortTimes(data.times || [], confirmedSet)

    this.setData({
      times: sortedTimes,
      errors: {},
      startDateValue,
      startDateLabel: formatDisplayDate(startDateValue),
      endDateValue,
      endDateLabel: endDateValue ? formatDisplayDateWithYear(endDateValue) : '长期',
      timePickerValue: sortedTimes.length ? sortedTimes[sortedTimes.length - 1].value : '08:00',
      'form.startDate': startDateValue,
      'form.endDate': endDateValue || '',
      confirmedTimes,
      isDirty: false
    })
    return data
  },

  async onLoad(options = {}) {
    this.setData({
      sourcePlanId: options.id || ''
    })
    bindAdaptiveResize(this)
    wx.setNavigationBarTitle({
      title: '添加用药'
    })
    await this.loadData(options.id)
    if (options.id) {
      wx.setNavigationBarTitle({
        title: '编辑用药'
      })
    }
  },

  onUnload() {
    unbindAdaptiveResize(this)
    // 清理当前页面的加载状态，防止页面销毁后残留条目阻塞后续实例
    if (this.route) {
      clearPageLoadState(this.route)
    }
  },

  async reloadPage() {
    await this.loadData(this.data.sourcePlanId)
  },

  handleInput(event) {
    const field = event.currentTarget.dataset.field
    this.setData({
      [`form.${field}`]: event.detail.value,
      [`errors.${field}`]: '',
      isDirty: true
    })
  },

  toggleTime(event) {
    const value = event.currentTarget.dataset.value
    const confirmedTimes = this.data.confirmedTimes || []
    if (confirmedTimes.includes(value)) {
      wx.showToast({ title: '该时间今日已确认，关闭后确认记录仍保留', icon: 'none', duration: 2000 })
    }
    const confirmedSet = new Set(confirmedTimes)
    const times = this.data.times.map((item) => {
      if (item.value !== value) return item
      const enabled = !item.enabled
      return {
        ...item,
        enabled,
        isConfirmed: enabled && confirmedSet.has(item.value)
      }
    })
    this.setData({
      times,
      'errors.times': '',
      isDirty: true
    })
  },

  handleTimePicked(event) {
    const value = event.detail.value
    const confirmedSet = new Set(this.data.confirmedTimes || [])
    const hasTime = this.data.times.some((item) => item.value === value)
    const times = hasTime
      ? this.data.times.map((item) => (item.value === value ? { ...item, enabled: true, isConfirmed: confirmedSet.has(value) } : item))
      : sortTimes(this.data.times.concat({ value, enabled: true, isConfirmed: false }), confirmedSet)

    this.setData({
      times,
      timePickerValue: value,
      'errors.times': '',
      isDirty: true
    })
  },

  handleTimeLongPress(event) {
    const value = event.currentTarget.dataset.value
    const index = this.data.times.findIndex(t => t.value === value)
    if (index < 0) return

    const isCustom = !DEFAULT_TIME_VALUES.includes(value)
    if (!isCustom) {
      wx.showToast({ title: '默认时间不支持修改，可关闭后添加新时间', icon: 'none' })
      return
    }

    this.setData({
      editingTimeIndex: index,
      timePickerValue: value
    })
    this.selectComponent('#editTimePicker') && this.selectComponent('#editTimePicker').show()
  },

  handleEditTimePicked(event) {
    const newValue = event.detail.value
    const index = this.data.editingTimeIndex
    if (index < 0) return

    const oldValue = this.data.times[index].value
    if (newValue === oldValue) return

    const duplicate = this.data.times.some(t => t.value === newValue)
    if (duplicate) {
      wx.showToast({ title: '该时间已存在', icon: 'none' })
      return
    }

    const confirmedSet = new Set(this.data.confirmedTimes || [])
    const times = this.data.times.map((item, i) => {
      if (i !== index) return item
      return { ...item, value: newValue, isConfirmed: item.enabled && confirmedSet.has(newValue) }
    })

    this.setData({
      times: sortTimes(times, confirmedSet),
      editingTimeIndex: -1,
      isDirty: true
    })
  },

  toggleSubscribe(event) {
    this.setData({
      'form.subscribe': event.detail.value,
      isDirty: true
    })
  },

  handleStartDateChange(event) {
    const startDateValue = event.detail.value
    if (!startDateValue) return
    this.setData({
      startDateValue,
      startDateLabel: formatDisplayDate(startDateValue),
      'form.startDate': startDateValue,
      isDirty: true
    })
  },

  handleEndDateChange(event) {
    const endDateValue = event.detail.value
    if (!endDateValue) return
    this.setData({
      endDateValue,
      endDateLabel: endDateValue ? formatDisplayDateWithYear(endDateValue) : '长期',
      'form.endDate': endDateValue,
      isDirty: true
    })
  },

  handleDatePickerCancel() {
    // picker 取消时的兜底处理，确保原生遮罩层正确回收
  },

  clearEndDate() {
    this.setData({
      endDateValue: '',
      endDateLabel: '长期',
      'form.endDate': '',
      isDirty: true
    })
  },

  async savePlan() {
    const enabledTimes = this.data.times.filter((item) => item.enabled).map((item) => item.value)
    const errors = {}

    if (!this.data.form.name.trim()) {
      errors.name = '请填写药品名称，便于提醒中心和计划列表识别。'
    }
    if (!enabledTimes.length) {
      errors.times = '请至少选择一个提醒时间。'
    }

    const dosage = (this.data.form.dosage || '').trim()
    if (dosage && !/^[\d\u4e00-\u9fa5a-zA-Z\s.\/]+$/.test(dosage)) {
      errors.dosage = '剂量说明仅支持数字、中文、英文字母和常见符号。'
    }

    if (this.data.endDateValue && this.data.endDateValue < this.data.startDateValue) {
      errors.endDate = '结束日期不能早于开始日期。'
    }

    this.setData({ errors })
    if (Object.keys(errors).length) {
      return
    }

    try {
      await runButtonAction(this, 'save', async () => {
        await saveMedicationPlan({
          id: this.data.planId,
          name: this.data.form.name,
          dosage: this.data.form.dosage,
          subscribe: this.data.form.subscribe,
          startDate: this.data.form.startDate,
          endDate: this.data.form.endDate || '',
          times: enabledTimes
        })

        this.setData({ isDirty: false })

        if (this.data.form.subscribe) {
          // 检查模板 ID 是否已配置
          const medicineConfigured = isTemplateConfigured('medicine')

          if (!medicineConfigured && DEV_MODE) {
            // 开发模式：模板未配置，跳过授权，直接提示并返回
            console.warn('[med-edit] 订阅消息模板 ID 未配置，跳过授权流程。请在 utils/subscribe-config.js 中配置真实模板 ID。')
            wx.showToast({
              title: '用药计划已保存（开发模式：订阅消息模板未配置）',
              icon: 'none',
              duration: 2500
            })
            this._navTimer = setTimeout(() => {
              const pages = getCurrentPages()
              if (pages.length > 1) {
                wx.navigateBack()
              } else {
                goRoute('medList')
              }
            }, 1500)
            return
          }

          // 调起订阅消息授权
          const subscribeResult = await requestSubscription(['medicine'], { silent: true })

          if (subscribeResult.ok) {
            // 授权成功
            wx.showToast({
              title: '已开启用药微信提醒',
              icon: 'success',
              duration: 1500
            })
            this._navTimer = setTimeout(() => {
              const pages = getCurrentPages()
              if (pages.length > 1) {
                wx.navigateBack()
              } else {
                goRoute('medList')
              }
            }, 1200)
            return
          }

          // 授权失败或用户拒绝
          if (subscribeResult.reason === 'template-not-configured') {
            // 模板未配置（生产模式）
            wx.showModal({
              title: '订阅消息未配置',
              content: '订阅消息模板 ID 未配置，无法开启微信提醒。你仍可在提醒中心查看待办。是否前往提醒设置查看？',
              confirmText: '去设置',
              cancelText: '暂不',
              confirmColor: '#168957',
              success: (result) => {
                if (result.confirm) {
                  goRoute('reminderSettings')
                } else {
                  const pages = getCurrentPages()
                  if (pages.length > 1) {
                    wx.navigateBack()
                  } else {
                    goRoute('medList')
                  }
                }
              }
            })
            return
          }

          // 用户拒绝授权或授权失败
          wx.showModal({
            title: '微信提醒未开启',
            content: '未开启微信提醒时，你仍可在提醒中心查看待办。是否前往提醒设置开启？',
            confirmText: '去设置',
            cancelText: '暂不',
            confirmColor: '#168957',
            success: (result) => {
              if (result.confirm) {
                goRoute('reminderSettings')
              } else {
                const pages = getCurrentPages()
                if (pages.length > 1) {
                  wx.navigateBack()
                } else {
                  goRoute('medList')
                }
              }
            }
          })
          return
        }

        const pages = getCurrentPages()
        if (pages.length > 1) {
          wx.navigateBack()
        } else {
          goRoute('medList')
        }
      })
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '保存失败，请稍后重试',
        icon: 'none'
      })
    }
  },

  handleBack() {
    if (!this.data.isDirty) {
      wx.navigateBack()
      return
    }
    wx.showModal({
      title: '未保存的修改',
      content: '当前表单有未保存的修改，确认离开吗？',
      confirmText: '离开',
      confirmColor: '#C8463A',
      success(result) {
        if (result.confirm) {
          wx.navigateBack()
        }
      }
    })
  }
})

const DEFAULT_TIME_VALUES = ['07:00', '12:00', '18:00', '21:00']
