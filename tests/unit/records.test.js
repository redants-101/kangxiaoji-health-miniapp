const {
  buildBloodPressureRecord,
  buildBloodGlucoseRecord,
  getRecordStatus,
  dedupeRecords,
  buildRecordSummary,
  extractCreatedAtDate,
  mapStoredRecordToListItem,
  mapStoredRecordToDetail,
  getStoredRecords
} = require('../../services/records')

describe('services/records', () => {
  describe('getRecordStatus', () => {
    it('warn 类型返回建议复测', () => {
      expect(getRecordStatus('warn')).toBe('建议复测')
    })

    it('其他类型返回正常', () => {
      expect(getRecordStatus('')).toBe('正常')
      expect(getRecordStatus('normal')).toBe('正常')
      expect(getRecordStatus(undefined)).toBe('正常')
    })
  })

  describe('buildBloodPressureRecord', () => {
    it('构建完整的血压记录', () => {
      const record = buildBloodPressureRecord({
        systolic: 128,
        diastolic: 78,
        pulse: 72,
        tag: '晨起',
        measuredAt: '07:30',
        level: '',
        tip: '血压正常',
        note: '感觉良好'
      })

      expect(record.type).toBe('bp')
      expect(record.source).toBe('local')
      expect(record.title).toContain('128/78')
      expect(record.value).toBe('128 / 78')
      expect(record.unit).toContain('mmHg')
      expect(record.unit).toContain('72')
      expect(record.status).toBe('正常')
      expect(record.details).toHaveLength(6)
      expect(record.details[0].label).toBe('收缩压（高压）')
      expect(record.details[0].value).toContain('128')
    })

    it('无心率时显示横杠', () => {
      const record = buildBloodPressureRecord({
        systolic: 120, diastolic: 80, pulse: '',
        tag: '睡前', measuredAt: '21:00', level: '', tip: ''
      })
      expect(record.unit).toContain('-')
    })

    it('高血压记录标记为建议复测', () => {
      const record = buildBloodPressureRecord({
        systolic: 150, diastolic: 95, pulse: 80,
        tag: '晨起', measuredAt: '07:30', level: 'warn', tip: '血压偏高'
      })
      expect(record.status).toBe('建议复测')
      expect(record.statusType).toBe('warn')
    })

    it('使用自定义 recordId', () => {
      const record = buildBloodPressureRecord({
        systolic: 120, diastolic: 80, pulse: 72,
        tag: '晨起', measuredAt: '07:30', level: '', tip: ''
      }, 'custom-id-123')
      expect(record.id).toBe('custom-id-123')
    })

    it('云来源记录标记为 cloud', () => {
      const record = buildBloodPressureRecord({
        systolic: 120, diastolic: 80, pulse: 72,
        tag: '晨起', measuredAt: '07:30', level: '', tip: ''
      }, null, 'cloud')
      expect(record.source).toBe('cloud')
    })
  })

  describe('buildBloodGlucoseRecord', () => {
    it('构建完整的血糖记录', () => {
      const record = buildBloodGlucoseRecord({
        glucose: 5.8,
        tag: '空腹',
        measuredAt: '06:30',
        level: '',
        tip: '血糖正常',
        note: ''
      })

      expect(record.type).toBe('bg')
      expect(record.title).toContain('5.8')
      expect(record.value).toBe('5.8')
      expect(record.unit).toBe('mmol/L')
      expect(record.status).toBe('已记录')
      expect(record.details).toHaveLength(4)
    })

    it('高血糖标记为建议复测', () => {
      const record = buildBloodGlucoseRecord({
        glucose: 8.5,
        tag: '餐后',
        measuredAt: '14:00',
        level: 'warn',
        tip: '血糖偏高'
      })
      expect(record.status).toBe('建议复测')
    })
  })

  describe('extractCreatedAtDate', () => {
    it('从 ISO 字符串提取日期', () => {
      expect(extractCreatedAtDate({ createdAt: '2026-04-27T08:00:00' })).toBe('2026-04-27')
    })

    it('从 created_at 字段提取日期', () => {
      expect(extractCreatedAtDate({ created_at: '2026-05-01T10:00:00' })).toBe('2026-05-01')
    })

    it('从 _id 提取日期（MongoDB ObjectId 格式）', () => {
      const record = { _id: '680f5a000000000000000001' }
      const date = extractCreatedAtDate(record)
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('从 time 字段提取日期', () => {
      expect(extractCreatedAtDate({ time: '2026-04-27 08:00' })).toBe('2026-04-27')
    })

    it('空对象返回空字符串', () => {
      expect(extractCreatedAtDate({})).toBe('')
      expect(extractCreatedAtDate(null)).toBe('')
    })

    it('中文日期格式提取日期', () => {
      const record = { time: '4月27日 08:00' }
      const date = extractCreatedAtDate(record)
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
  })

  describe('dedupeRecords', () => {
    it('按 id 去重', () => {
      const records = [
        { id: 'bp-1', type: 'bp', value: '120/80' },
        { id: 'bp-1', type: 'bp', value: '120/80' },
        { id: 'bg-1', type: 'bg', value: '5.8' }
      ]
      const result = dedupeRecords(records)
      expect(result).toHaveLength(2)
    })

    it('保留首次出现的记录', () => {
      const records = [
        { id: 'bp-1', value: 'first' },
        { id: 'bp-1', value: 'second' }
      ]
      const result = dedupeRecords(records)
      expect(result[0].value).toBe('first')
    })

    it('过滤 null 和无 id 的记录', () => {
      const records = [
        { id: 'bp-1', type: 'bp' },
        null,
        { type: 'bg' },
        { id: 'bg-1', type: 'bg' }
      ]
      const result = dedupeRecords(records)
      expect(result).toHaveLength(2)
    })

    it('空数组返回空数组', () => {
      expect(dedupeRecords([])).toEqual([])
    })
  })

  describe('buildRecordSummary', () => {
    it('统计本周记录', () => {
      const records = [
        { time: '2026-04-27 08:00', statusType: '', status: '正常' },
        { time: '2026-04-27 14:00', statusType: 'warn', status: '建议复测' },
        { time: '2026-04-28 08:00', statusType: '', status: '正常' }
      ]
      const summary = buildRecordSummary(records)
      expect(summary[0].label).toBe('本周记录')
      expect(summary[0].value).toBe('3次')
      expect(summary[2].label).toBe('建议复测')
      expect(summary[2].value).toBe('1次')
    })

    it('空记录返回零值', () => {
      const summary = buildRecordSummary([])
      expect(summary[0].value).toBe('0次')
      expect(summary[1].value).toBe('0天')
      expect(summary[2].value).toBe('0次')
    })
  })

  describe('mapStoredRecordToListItem', () => {
    it('映射记录到列表项', () => {
      const record = buildBloodPressureRecord({
        systolic: 120, diastolic: 80, pulse: 72,
        tag: '晨起', measuredAt: '07:30', level: '', tip: ''
      })
      const listItem = mapStoredRecordToListItem(record)
      expect(listItem.id).toBe(record.id)
      expect(listItem.type).toBe('bp')
      expect(listItem.title).toBeDefined()
      expect(listItem.createdAt).toBeDefined()
    })
  })

  describe('mapStoredRecordToDetail', () => {
    it('映射记录到详情', () => {
      const record = buildBloodPressureRecord({
        systolic: 120, diastolic: 80, pulse: 72,
        tag: '晨起', measuredAt: '07:30', level: '', tip: ''
      })
      const detail = mapStoredRecordToDetail(record)
      expect(detail.recordId).toBe(record.id)
      expect(detail.record.type).toBe('血压')
      expect(detail.details.length).toBeGreaterThanOrEqual(record.details.length)
    })

    it('详情包含创建时间', () => {
      const record = buildBloodPressureRecord({
        systolic: 120, diastolic: 80, pulse: 72,
        tag: '晨起', measuredAt: '07:30', level: '', tip: ''
      })
      const detail = mapStoredRecordToDetail(record)
      const createTimeDetail = detail.details.find(d => d.label === '创建时间')
      expect(createTimeDetail).toBeDefined()
    })
  })
})
