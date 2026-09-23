# 数据清理记录 — 2026-09-23 11:0x

范围：**仅本轮冒烟创建的 4 个合成文档**（见 smoke-record.md 登记表）。未删除任何历史 family_auth、family_members、family_invite_attempts 数据；未触碰健康记录集合。

| # | 集合 | 精确条件 | 删除 n | 复核（count=0） |
|---|---|---|---|---|
| 1 | family_invite_attempts | `_id=invite-fail-smoke-join-0923-2026-09-23` | 1 | openId=smoke-join-0923 → 0 |
| 2 | family_auth | `_id=smoke-a4a7-expired-auth` | 1 | `_id` 前缀 `^smoke-a4a7` → 0 |
| 3 | family_auth | `_id=smoke-a4a7-a6-auth`（含合成号码） | 1 | 同上 → 0 |
| 4 | family_members | `_id=smoke-a4a7-a6-member` | 1 | `_id` 前缀 `^smoke-a4a7` → 0 |

原始输出：cleanup-locate.txt / cleanup.txt。

遗留（非本轮产生，维持台账）：family_invite_attempts 中此前真机验收产生的 4 条 attempt 文档 → TTL 24h 自动清理，不手工干预。
