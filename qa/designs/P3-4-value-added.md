## 技术方案：P3-4 增值服务路径规划

### 实现思路

将用户反馈同步到云端；规划"AI 健康解读"增值功能入口（基于本周数据生成文字摘要）；在首页和"我的"页增加增值服务发现入口（灰度展示）。

### 架构设计

```
增值服务架构：

1. 反馈同步（短期）
   submitFeedback → 本地保存 + 云端同步
   → 云数据库 feedbacks 集合

2. AI 健康解读（中期）
   首页"健康解读"入口
   → 获取本周记录数据
   → 调用云函数 generateHealthInsight
   → 云函数调用大模型 API
   → 返回解读文本
   → 展示解读结果

3. 在线问诊转介（长期，规划）
   "我的"页"健康服务"入口
   → 跳转第三方医疗平台小程序
```

### 数据流程

#### 反馈同步

```
1. 用户提交反馈
2. submitFeedbackLocal：本地保存
3. resolveRemote：同步到云端 feedbacks 集合
4. 云端存储：{ _openid, type, content, contact, createdAt, status: 'pending' }
```

#### AI 健康解读

```
1. 用户点击"健康解读"
2. 前端获取本周记录数据
3. 调用云函数 generateHealthInsight({ records, profile })
4. 云函数构建提示词：
   "基于以下健康数据，生成一段简短的健康解读（200字以内）：
    本周血压：平均 128/78 mmHg，共 5 次记录
    本周血糖：平均 5.8 mmol/L，共 3 次记录
    异常项：2 次血压偏高"
5. 调用大模型 API
6. 返回解读文本
7. 前端展示解读结果 + 免责声明
```

### 接口定义

#### 反馈同步修改

```javascript
// services/feedback.js 修改
function submitFeedback(payload) {
  const feedback = submitFeedbackLocal(payload)
  // 增加云端同步（之前仅本地保存）
  return resolveRemote('submitFeedback', feedback, () => feedback, {
    mirrorLocal: true
  })
}
```

#### AI 健康解读云函数

```javascript
// cloudfunctions/healthApi/insight-service.js（规划）
async function generateHealthInsight(openId, records, profile) {
  const weekBpRecords = records.filter(r => r.type === 'bp')
  const weekBgRecords = records.filter(r => r.type === 'bg')

  const prompt = buildInsightPrompt(weekBpRecords, weekBgRecords, profile)
  // 调用大模型 API（需配置 API Key）
  const result = await callLLM(prompt)
  return {
    insight: result.text,
    generatedAt: new Date().toISOString(),
    disclaimer: '以上解读仅供参考，不构成诊断或治疗建议。如有健康问题，请咨询专业医生。'
  }
}
```

#### 灰度控制

```javascript
// api-config.js
const featureFlags = {
  // ... 现有开关
  aiInsight: false,       // AI 健康解读（默认关闭）
  healthService: false    // 在线问诊转介（默认关闭）
}
```

### 与现有系统的兼容性

- **反馈同步**：`submitFeedback` 行为不变，增加云端同步不影响本地保存
- **AI 解读**：灰度控制，默认关闭，不影响现有用户
- **增值服务入口**：灰度展示，不影响核心功能布局

### 回滚方案

1. 通过 `featureFlags.aiInsight` 和 `featureFlags.healthService` 开关关闭
2. 关闭后增值服务入口不展示
