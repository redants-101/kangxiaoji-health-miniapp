## 技术方案：P2-2 适老化深度优化

### 实现思路

在现有 `ui-scale-elder` 字体放大基础上，增加交互热区放大、间距增加、错误信息展示优化、时间快捷选择和场景标签联动。

### 架构设计

```
适老化优化层次：

1. 字体放大（已实现）→ ui-scale-elder CSS 类
2. 热区放大（新增）→ min-height: 120rpx, padding 增加
3. 间距增加（新增）→ gap/line-height/margin 增加 50%
4. 错误展示（新增）→ 行内小字 → notice 组件
5. 快捷时间（新增）→ 时间选择辅助按钮
6. 场景联动（新增）→ 标签选择自动设置时间
```

### 数据流程

#### 快捷时间选择

```
1. 血压/血糖记录页展示时间选择区域
2. 区域包含：picker 入口 + 快捷时间按钮（"现在""晨起""睡前"）
3. 点击"现在"→ measuredAt = getCurrentTimeValue()
4. 点击"晨起"→ measuredAt = "06:00"
5. 点击"睡前"→ measuredAt = "21:00"
6. 用户仍可通过 picker 手动选择任意时间
```

#### 场景标签联动

```
1. 用户选择血糖场景标签
2. 根据标签自动设置默认时间：
   - "空腹" → "06:00"
   - "餐前" → "11:30"
   - "餐后" → 当前时间（餐后2小时）
   - "睡前" → "21:00"
   - "其他" → 不变
3. 用户仍可手动修改时间
4. 仅在时间未被用户手动修改过时自动联动
```

### 接口定义

#### 血压记录页新增数据字段

```javascript
// pages/record/record-bp/index.js
data: {
  // ... 现有字段
  quickTimes: [
    { label: '现在', value: 'now' },
    { label: '晨起', value: '06:00' },
    { label: '睡前', value: '21:00' }
  ],
  timeManuallySet: false  // 用户是否手动修改过时间
}
```

#### 血糖记录页新增数据字段

```javascript
// pages/record/record-bg/index.js
data: {
  // ... 现有字段
  quickTimes: [
    { label: '现在', value: 'now' },
    { label: '空腹', value: '06:00' },
    { label: '餐后', value: 'afterMeal' },
    { label: '睡前', value: '21:00' }
  ],
  timeManuallySet: false
}
```

#### 适老化 CSS 新增

```css
/* app.wxss 新增 */
.ui-scale-elder .task-row,
.ui-scale-elder .med-row,
.ui-scale-elder .record-row,
.ui-scale-elder .action-row,
.ui-scale-elder .setting-row {
  min-height: 120rpx;
  padding: 28rpx 0;
  gap: 28rpx;
}

.ui-scale-elder .primary-button,
.ui-scale-elder .secondary-button,
.ui-scale-elder .danger-button,
.ui-scale-elder .action-button {
  min-height: 120rpx;
  font-size: 34rpx;
  border-radius: 24rpx;
}

.ui-scale-elder .quick-tile {
  min-height: 180rpx;
  gap: 14rpx;
  font-size: 32rpx;
}

.ui-scale-elder .field-error {
  display: none;
}

.ui-scale-elder .field-error-notice {
  display: block;
}
```

### 与现有系统的兼容性

- **普通模式不受影响**：所有适老化样式仅在 `ui-scale-elder` 类下生效
- **快捷时间按钮**：与现有 picker 共存，不替代 picker 功能
- **场景联动**：仅在时间未被手动修改时自动设置，不覆盖用户选择
- **错误展示**：老年模式下 notice 组件和行内错误信息同时存在，notice 更醒目

### 回滚方案

1. 删除新增的 CSS 规则
2. 删除快捷时间按钮和场景联动逻辑
3. 恢复错误信息为行内展示
