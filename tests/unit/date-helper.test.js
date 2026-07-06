const {
  formatDisplayDate,
  formatDisplayDateWithYear,
  parseDisplayDateTime,
  getTodayDateValue,
  getCurrentTimeValue,
  normalizeDateValue,
  getWeekStartDate
} = require('../../utils/date-helper')

describe('utils/date-helper', () => {
  describe('getTodayDateValue', () => {
    it('返回 YYYY-MM-DD 格式', () => {
      const result = getTodayDateValue(new Date(2026, 3, 27))
      expect(result).toBe('2026-04-27')
    })

    it('月份和日期补零', () => {
      const result = getTodayDateValue(new Date(2026, 0, 5))
      expect(result).toBe('2026-01-05')
    })
  })

  describe('getCurrentTimeValue', () => {
    it('返回 HH:MM 格式', () => {
      const result = getCurrentTimeValue(new Date(2026, 3, 27, 7, 30))
      expect(result).toBe('07:30')
    })
  })

  describe('normalizeDateValue', () => {
    it('合法日期原样返回', () => {
      expect(normalizeDateValue('2026-04-27')).toBe('2026-04-27')
    })

    it('非法日期返回 fallback', () => {
      expect(normalizeDateValue('invalid')).toBe(getTodayDateValue())
    })

    it('空值返回 fallback', () => {
      expect(normalizeDateValue('')).toBe(getTodayDateValue())
    })
  })

  describe('formatDisplayDate', () => {
    it('今天显示"今天"', () => {
      const today = getTodayDateValue()
      expect(formatDisplayDate(today, today)).toBe('今天')
    })

    it('非今天显示"月日"格式', () => {
      expect(formatDisplayDate('2026-04-27', '2026-04-28')).toBe('4月27日')
    })

    it('空值返回空字符串', () => {
      expect(formatDisplayDate('', '2026-04-27')).toBe('')
    })
  })

  describe('formatDisplayDateWithYear', () => {
    it('今天显示"今天"', () => {
      const today = getTodayDateValue()
      expect(formatDisplayDateWithYear(today, today)).toBe('今天')
    })

    it('非今天显示"年月日"格式', () => {
      expect(formatDisplayDateWithYear('2026-04-27', '2026-04-28')).toBe('2026年4月27日')
    })
  })

  describe('parseDisplayDateTime', () => {
    it('解析 YYYY-MM-DD HH:MM 格式', () => {
      const result = parseDisplayDateTime('2026-04-27 08:30')
      expect(result.dateValue).toBe('2026-04-27')
      expect(result.timeValue).toBe('08:30')
    })

    it('解析"今天 HH:MM"格式', () => {
      const now = new Date(2026, 3, 27)
      const result = parseDisplayDateTime('今天 07:30', now)
      expect(result.dateValue).toBe('2026-04-27')
      expect(result.timeValue).toBe('07:30')
    })

    it('解析"M月D日 HH:MM"格式', () => {
      const now = new Date(2026, 3, 27)
      const result = parseDisplayDateTime('4月25日 14:00', now)
      expect(result.dateValue).toBe('2026-04-25')
      expect(result.timeValue).toBe('14:00')
    })

    it('空值返回当前日期时间', () => {
      const now = new Date(2026, 3, 27, 8, 30)
      const result = parseDisplayDateTime('', now)
      expect(result.dateValue).toBe('2026-04-27')
    })

    it('null/undefined 返回当前日期时间', () => {
      const now = new Date(2026, 3, 27, 8, 30)
      const result = parseDisplayDateTime(null, now)
      expect(result.dateValue).toBe('2026-04-27')
    })
  })

  describe('getWeekStartDate', () => {
    it('周一返回本周一', () => {
      const monday = new Date(2026, 3, 27)
      const result = getWeekStartDate(monday)
      expect(result).toBe('2026-04-27')
    })

    it('周日返回上周一', () => {
      const sunday = new Date(2026, 3, 26)
      const result = getWeekStartDate(sunday)
      expect(result).toBe('2026-04-20')
    })

    it('周三返回本周一', () => {
      const wednesday = new Date(2026, 3, 29)
      const result = getWeekStartDate(wednesday)
      expect(result).toBe('2026-04-27')
    })
  })
})
