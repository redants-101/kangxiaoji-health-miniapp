/**
 * 日期时间展示与 picker 值转换工具。
 * 统一处理“今天 07:30”“4月25日 07:30”“2026-04-25”这类页面展示值。
 */

function pad2(value) {
  return String(value).padStart(2, '0')
}

function getTodayDateValue(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

function getCurrentTimeValue(now = new Date()) {
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
}

function normalizeDateValue(value, fallback = getTodayDateValue()) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value
  }
  return fallback
}

function formatDisplayDate(dateValue, todayDateValue = getTodayDateValue()) {
  if (!dateValue) return ''
  if (dateValue === todayDateValue) return '今天'
  const [, month, day] = dateValue.split('-')
  return `${Number(month)}月${Number(day)}日`
}

function formatDisplayDateWithYear(dateValue, todayDateValue = getTodayDateValue()) {
  if (!dateValue) return ''
  if (dateValue === todayDateValue) return '今天'
  const [year, month, day] = dateValue.split('-')
  return `${year}年${Number(month)}月${Number(day)}日`
}

function formatDisplayDateTime(dateValue, timeValue, todayDateValue = getTodayDateValue()) {
  if (!dateValue || !timeValue) return ''
  return `${formatDisplayDate(dateValue, todayDateValue)} ${timeValue}`
}

function parseDisplayDateTime(value, now = new Date()) {
  const todayDateValue = getTodayDateValue(now)
  const defaultValue = {
    dateValue: todayDateValue,
    timeValue: getCurrentTimeValue(now)
  }

  if (typeof value !== 'string' || !value.trim()) {
    return defaultValue
  }

  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(value)) {
    return {
      dateValue: value.slice(0, 10),
      timeValue: value.slice(-5)
    }
  }

  if (/^今天\s+\d{2}:\d{2}$/.test(value)) {
    return {
      dateValue: todayDateValue,
      timeValue: value.slice(-5)
    }
  }

  const shortMatch = value.match(/^(\d{1,2})月(\d{1,2})日\s+(\d{2}:\d{2})$/)
  if (shortMatch) {
    return {
      dateValue: `${now.getFullYear()}-${pad2(shortMatch[1])}-${pad2(shortMatch[2])}`,
      timeValue: shortMatch[3]
    }
  }

  return defaultValue
}

function getWeekStartDate(now = new Date()) {
  const day = now.getDay()
  const diff = day === 0 ? 6 : day - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - diff)
  return `${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(monday.getDate())}`
}

module.exports = {
  formatDisplayDate,
  formatDisplayDateWithYear,
  formatDisplayDateTime,
  getCurrentTimeValue,
  getTodayDateValue,
  getWeekStartDate,
  normalizeDateValue,
  parseDisplayDateTime
}
