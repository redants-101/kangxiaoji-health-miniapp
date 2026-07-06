## 技术方案：P1-1 首页空状态引导 + 快捷记录入口

### 实现思路

首页无记录时展示"开始第一次记录"CTA 按钮；页面右下角增加悬浮"+"按钮，点击弹出记录类型选择面板；趋势页无数据时展示引导文案；新增新手引导流程（2-3屏，可跳过）。

### 架构设计

```
┌─────────────────────────────────────┐
│              首页布局                 │
│                                      │
│  ┌──────────────────────────────┐    │
│  │ 问候语 + 标题                │    │
│  └──────────────────────────────┘    │
│                                      │
│  ┌──────────────────────────────┐    │
│  │ 今日待办（空状态时隐藏）      │    │
│  └──────────────────────────────┘    │
│                                      │
│  ┌──────────────────────────────┐    │
│  │ 快速记录 / 空状态 CTA        │    │
│  │ （无记录时展示引导卡片）      │    │
│  └──────────────────────────────┘    │
│                                      │
│  ┌──────────────────────────────┐    │
│  │ 最新记录（空状态时隐藏）      │    │
│  └──────────────────────────────┘    │
│                                      │
│                          ┌─────┐     │
│                          │  +  │ ← 悬浮按钮
│                          └─────┘     │
└─────────────────────────────────────┘

点击"+"按钮后弹出：
┌─────────────────────────────────────┐
│  ┌────────┐  ┌────────┐            │
│  │ 记血压  │  │ 记血糖  │            │
│  └────────┘  └────────┘            │
└─────────────────────────────────────┘
```

### 数据流程

#### 空状态判断

```
1. 首页加载后检查 latestMetrics 和 weeklyOverview
2. 如果 latestMetrics 全部 hasData=false 且 weeklyOverview 为空：
   → 展示空状态引导卡片
3. 如果有部分数据：
   → 正常展示，无数据项展示 metric-empty-card
```

#### 悬浮按钮交互

```
1. 点击"+"按钮
2. 设置 showQuickRecord = true
3. 展示记录类型选择面板（半屏弹窗）
4. 用户选择"记血压"→ goRoute('recordBp')
5. 用户选择"记血糖"→ goRoute('recordBg')
6. 点击遮罩层关闭面板
```

#### 新手引导

```
1. 首次进入首页时检查 onboardingCompleted 标记
2. 未完成：展示引导浮层（第1/3屏）
3. 用户点击"下一步"→ 第2/3屏 → 第3/3屏
4. 用户点击"跳过"或完成第3屏 → 设置 onboardingCompleted = true
5. 后续进入首页不再展示
```

### 接口定义

#### 首页数据新增字段

```javascript
// services/page-data.js DEFAULT_PAGE_DATA.home 新增
home: {
  // ... 现有字段
  showQuickRecord: false,  // 悬浮按钮弹窗状态
  onboardingCompleted: false  // 新手引导完成标记
}
```

#### 悬浮按钮组件

```javascript
// components/floating-record/index.js
Component({
  properties: {
    show: { type: Boolean, value: false }
  },
  methods: {
    onTapButton() {
      this.triggerEvent('toggle')
    },
    onSelectBp() {
      this.triggerEvent('select', { route: 'recordBp' })
    },
    onSelectBg() {
      this.triggerEvent('select', { route: 'recordBg' })
    },
    onMaskTap() {
      this.triggerEvent('toggle')
    }
  }
})
```

#### 趋势页空状态

```javascript
// pages/trend/index.js 修改 updateChart
updateChart() {
  if (!this.data.records || !this.data.records.length) {
    // 无数据时展示引导文案
    this.setData({
      chartBars: [],
      chartA11yLabel: '',
      emptyHint: '开始记录后，这里将展示你的健康趋势'
    })
    return
  }
  // ... 现有逻辑
}
```

### 与现有系统的兼容性

- **有数据用户**：悬浮按钮和空状态引导不影响现有首页展示
- **快速记录入口**：与首页"快速记录"区域功能重叠但入口不同，悬浮按钮更便捷
- **新手引导**：通过 `onboardingCompleted` 标记控制，已完成用户不受影响
- **TabBar**：悬浮按钮位于右下角，不遮挡 TabBar（通过 `bottom: calc(env(safe-area-inset-bottom) + 120rpx)` 定位）

### 回滚方案

1. 悬浮按钮通过 `featureFlags.floatingRecord` 开关控制
2. 空状态引导通过 `showEmptyGuide` 数据字段控制，设为 false 即隐藏
3. 新手引导通过 `onboardingCompleted` 标记控制，设为 true 即跳过
