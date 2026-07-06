## 技术方案：P1-4 周报动态生成

### 实现思路

重构 `services/report.js`，基于 `getStoredRecords()` 本地数据动态计算周报摘要、趋势和异常项；趋势图数据基于真实记录而非硬编码的 `TREND_SERIES_MAP`。

### 架构设计

```
┌──────────────────────────────────────────────┐
│              周报数据构建流程                   │
│                                               │
│  getStoredRecords()                           │
│       │                                       │
│       ▼                                       │
│  filterWeekRecords(本周一 ~ 今天)               │
│       │                                       │
│       ├──▶ buildReportSummary()               │
│  │    统计：平均收缩压/舒张压/血糖、记录次数      │
│  │                                            │
│  ├──▶ buildReportFocusItems()                 │
│  │    识别：偏高/偏低记录、异常趋势              │
│  │                                            │
│  └──▶ buildReportChart()                     │
│       每日最新记录 → 柱状图数据                  │
└──────────────────────────────────────────────┘
```

### 数据流程

```
1. 获取本地所有记录：getStoredRecords()
2. 过滤本周记录：
   - 日期范围：getWeekStartDate(now) ~ getTodayDateValue(now)
   - 保留 type 为 'bp' 或 'bg' 的记录
3. 按类型分组：
   - bpRecords：所有血压记录
   - bgRecords：所有血糖记录
4. 计算摘要：
   - 血压：平均收缩压、平均舒张压、最高收缩压、记录次数
   - 血糖：平均血糖值、最高值、最低值、记录次数
5. 识别异常项：
   - statusType === 'warn' 的记录
   - 连续偏高趋势（最近3次均偏高）
6. 构建图表数据：
   - 按日期分组，每天取最新一条记录
   - 转换为 chartBars 格式
```

### 接口定义

#### report.js 重构

```javascript
const { getStoredRecords } = require('./records')
const { getTodayDateValue, getWeekStartDate, parseDisplayDateTime } = require('../utils/date-helper')
const { buildReportChart: buildChart } = require('../utils/chart-adapter')

function filterWeekRecords(records) {
  const now = new Date()
  const weekStart = getWeekStartDate(now)
  const todayStr = getTodayDateValue(now)
  return records.filter(item => {
    const dateStr = extractCreatedAtDate(item)
    return dateStr >= weekStart && dateStr <= todayStr
  })
}

function buildReportSummary(bpRecords, bgRecords) {
  const summary = []
  if (bpRecords.length) {
    const systolics = bpRecords.map(r => parseInt(r.details?.[0]?.value) || parseInt(r.value?.split('/')[0]) || 0).filter(v => v > 0)
    const diastolics = bpRecords.map(r => parseInt(r.details?.[1]?.value) || parseInt(r.value?.split('/')[1]) || 0).filter(v => v > 0)
    summary.push({
      label: '血压',
      items: [
        { label: '平均收缩压', value: systolics.length ? Math.round(systolics.reduce((a, b) => a + b, 0) / systolics.length) : '-', unit: 'mmHg' },
        { label: '平均舒张压', value: diastolics.length ? Math.round(diastolics.reduce((a, b) => a + b, 0) / diastolics.length) : '-', unit: 'mmHg' },
        { label: '记录次数', value: `${bpRecords.length}次` }
      ]
    })
  }
  if (bgRecords.length) {
    const glucoses = bgRecords.map(r => parseFloat(r.value) || 0).filter(v => v > 0)
    summary.push({
      label: '血糖',
      items: [
        { label: '平均血糖', value: glucoses.length ? (glucoses.reduce((a, b) => a + b, 0) / glucoses.length).toFixed(1) : '-', unit: 'mmol/L' },
        { label: '最高值', value: glucoses.length ? Math.max(...glucoses).toFixed(1) : '-', unit: 'mmol/L' },
        { label: '记录次数', value: `${bgRecords.length}次` }
      ]
    })
  }
  return summary
}

function buildReportFocusItems(records) {
  return records
    .filter(r => r.statusType === 'warn' || r.status === '建议复测')
    .map(r => ({
      id: r.id,
      type: r.type === 'bp' ? '血压' : '血糖',
      value: r.value,
      unit: r.unit,
      time: r.time,
      tag: r.tag,
      reason: r.tip || '数值偏高，建议复测'
    }))
}

function getReportData() {
  const allRecords = getStoredRecords()
  const weekRecords = filterWeekRecords(allRecords)
  const bpRecords = weekRecords.filter(r => r.type === 'bp')
  const bgRecords = weekRecords.filter(r => r.type === 'bg')

  if (!weekRecords.length) {
    return Promise.resolve({
      period: '本周',
      subtitle: '暂无记录',
      summary: [],
      focusItems: [],
      chartBars: [],
      chartA11yLabel: '本周暂无健康记录',
      emptyHint: '本周暂无记录，开始记录后周报将自动生成'
    })
  }

  const summary = buildReportSummary(bpRecords, bgRecords)
  const focusItems = buildReportFocusItems(weekRecords)
  const chartData = buildChart('本周', '', {
    labels: weekRecords.map(r => extractCreatedAtDate(r).slice(5)),
    values: bpRecords.length
      ? bpRecords.map(r => parseInt(r.value?.split('/')[0]) || 0)
      : bgRecords.map(r => parseFloat(r.value) || 0)
  })

  return Promise.resolve({
    period: '本周',
    subtitle: `${weekRecords.length}次记录`,
    summary,
    focusItems,
    ...chartData,
    emptyHint: ''
  })
}
```

### 与现有系统的兼容性

- **无本地记录时**：返回空状态数据，页面展示"暂无记录"引导
- **有本地记录时**：动态生成周报，不再依赖云端数据
- **趋势页**：`getTrendData` 仍使用 `resolveMockData('trend')`，后续可同样改为动态生成
- **chart-adapter.js**：`buildReportChart` 函数签名不变，仅数据来源从硬编码改为真实记录

### 回滚方案

通过 `featureFlags.dynamicReport` 开关控制：
- `true`：使用动态生成的周报数据
- `false`：回退到 `resolveMockData('report')` 透传云端数据
