## 技术方案：P3-2 数据导出多格式支持

### 实现思路

在现有 JSON 导出基础上，新增 CSV 和纯文本格式转换函数；导出页增加格式选择；CSV 添加 BOM 头确保中文编码正确。

### 架构设计

```
导出流程：

getLocalDataSnapshot()
    │
    ├── toExportJSON(data) → JSON 格式（现有）
    ├── toExportCSV(data)  → CSV 格式（新增）
    └── toExportText(data) → 纯文本格式（新增）

导出页：
  格式选择：[JSON] [CSV] [纯文本]
  → 根据选择调用对应转换函数
  → 返回 { exportText, fileName, format }
```

### 接口定义

#### CSV 导出

```javascript
function toExportCSV(exportData) {
  const BOM = '\uFEFF'
  const headers = ['类型', '数值', '单位', '时间', '场景', '状态', '创建时间']
  const records = exportData.data.records || []
  const rows = records.map(r => [
    r.type === 'bp' ? '血压' : '血糖',
    r.value || '',
    r.unit || '',
    r.time || '',
    r.tag || '',
    r.status || '',
    extractCreatedAtDate(r) || ''
  ])
  const csv = [headers, ...rows].map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\n')
  return BOM + csv
}
```

#### 纯文本导出

```javascript
function toExportPlainText(exportData) {
  const lines = []
  lines.push('═══════════════════════════════')
  lines.push('  康小记个人数据导出')
  lines.push(`  导出时间：${exportData.generatedAt}`)
  lines.push('═══════════════════════════════')
  lines.push('')

  const records = exportData.data.records || []
  if (records.length) {
    lines.push(`【健康记录】共 ${records.length} 条`)
    lines.push('───────────────────────────────')
    records.forEach((r, i) => {
      lines.push(`${i + 1}. ${r.type === 'bp' ? '血压' : '血糖'} ${r.value} ${r.unit}`)
      lines.push(`   时间：${r.time}  场景：${r.tag || '-'}  状态：${r.status}`)
      if (r.details) {
        r.details.forEach(d => {
          lines.push(`   ${d.label}：${d.value}`)
        })
      }
      lines.push('')
    })
  }

  const plans = exportData.data.medicationPlans || []
  if (plans.length) {
    lines.push(`【用药计划】共 ${plans.length} 个`)
    lines.push('───────────────────────────────')
    plans.forEach((p, i) => {
      lines.push(`${i + 1}. ${p.name} ${p.dosage || ''}`)
      lines.push(`   时间：${(p.times || []).join(', ')}  状态：${p.status || '启用'}`)
      lines.push('')
    })
  }

  return lines.join('\n')
}
```

#### 导出入口修改

```javascript
function exportUserDataLocal(format = 'json') {
  const exportData = {
    version: EXPORT_VERSION,
    generatedAt: new Date().toISOString(),
    format,
    data: getLocalDataSnapshot()
  }

  const converters = {
    json: () => toExportText(exportData),
    csv: () => toExportCSV(exportData),
    text: () => toExportPlainText(exportData)
  }

  const exportText = (converters[format] || converters.json)()
  return { ...exportData, exportText, format }
}
```

### 与现有系统的兼容性

- **默认格式仍为 JSON**：`exportUserData()` 无参数时行为不变
- **CSV BOM 头**：确保 Excel 正确识别 UTF-8 编码
- **纯文本格式**：适合打印和阅读，不包含 JSON 语法

### 回滚方案

删除 CSV 和纯文本转换函数，导出页移除格式选择。
