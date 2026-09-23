# A6 子批次总结（电话提醒）— 2026-09-23 夜间批次

分支 `feat/family-permission`（HEAD `a751776`）。本子批次未提交、未切分支、未部署、未操作云端、未拍截图（清单已备）。

## 变更文件（24 = 23 改 + 1 新测试）

- 服务端：cloudfunctions/healthApi/family-policy.js（normalizeContactPhone/maskContactPhone/canCallReminderPhone/CONTACT_PHONE_PATTERN）、family-service.js（setFamilyContactPhone/familyGetReminderPhone/getOwnerContactPhone；homeFamily +phoneReminder+readPermissions；familyAuth +contactPhone 回读；createFamilyInvite 携带号码；getFamilyData 纯电话文档守卫）、index.js（2 条 action 装配）、static-pages.js（隐私政策×2 + 用户协议×1 电话条款）
- 客户端：services/family.js（setFamilyContactPhone/familyGetReminderPhone 包装）、utils/api.js（映射）
- 页面：home-family（电话提醒 section + handleCallReminder + readPermissions 门控各 section + 过期"代录待开放"文案修正）、family-auth（提醒电话编辑区：回显/预检/保存/清空）、family-invite（可选电话 + 授权勾选 gate + 草稿脏检查）+ 三页 wxss
- 测试装配：a0/a1/a2×2/a3/a4/a5 六个测试文件 + scripts/health-api-regression.js 的 createFamilyService 依赖补 3 个新 policy 函数（纯装配，无断言改动）
- 新测试：tests/unit/a6-phone-reminder.test.js（22 用例）

## 测试

- 测试先行：before.txt = 20 failed / 2 passed（2 个通过者为契约固定与数据形状固化测试）。
- 实现后：A6 目标 22/22（after.txt）；A0–A6 九套件联跑 173/173。
- 全量 Jest：617/619 —— 仅 2 失败为 settings.test.js 时区对（北京时间 00:00–08:00 窗口，单独记录，未掩盖）。
- regression：ok；lint：43 problems（11e/32w）与基线一致。**cloudfunctions/ 不在现有 lint 范围**（本批改了 4 个云端文件，明确写出）。
- 覆盖对照需求：owner 设置✓（含修改/清空）；remind=true 脱敏展示+拨号入口✓；remind=false 无按钮且不回传完整号（脱敏也不回）✓；read=false+remind=true 仅电话✓；清空后未配置状态✓；撤销后取号拒绝✓；缓存/日志/data/storage 无完整号✓；makePhoneCall 失败显式提示不假设已拨出✓；不实现 getPhoneNumber✓；sendDueReminders 零改动（契约扫描测试）✓；格式/未配置/权限关闭/已撤销状态✓。

## fix.patch

24 个 diff 段；基线 = pre-a5 快照 + A5 补丁（pre-a6 树）；校验 APPLIED-CLEAN + 24/24 逐字节 MATCH。

## 状态口径

- **本地已验证**：上述全部。
- **代码已完成但未部署**：A6 全部（云端 4 文件 + 前端 3 页面 + services/utils）。
- **云端待验证**：setFamilyContactPhone / familyGetReminderPhone 部署后真实响应；appConfig 无关（A7）。
- **需要双手机验证**：B 端拨号全链路（A6-P03/P04/P08）、A 关 remind/清号后 B 端状态（P05/P07）。
- **需要人工截图**：A6-P01..P08（screenshot-list.md）。
- **需要 CloudBase 控制台操作**：无新增集合（contactPhone 复用 family_auth；安全规则既有"仅云函数读写"覆盖）。
