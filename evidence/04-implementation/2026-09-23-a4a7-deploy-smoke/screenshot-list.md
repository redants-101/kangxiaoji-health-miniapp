# 双手机验收截图清单（A3-F / A4-F / A6-P / A7-T）

保存目录：`evidence/04-implementation/visual-input/screenshots/`；命名：`编号-YYYYMMDD-HHmm.png`；每张在 `shots-log.md` 记录真实操作与时间。截图只证明页面显示，配对佐证（接口响应/db 掩码记录）单独归档。

## A3 家属只读（5）

| 编号 | 场景 | 配对佐证 |
|---|---|---|
| A3-F01 | B 家属首页：A 的授权范围数据展示 | homeFamily 响应（掩码） |
| A3-F02 | B 家属态趋势页：owner 数据曲线（tabBar 进入） | trend familyView 响应 |
| A3-F03 | B 记录列表+详情：只读，无删除入口 | recordList/recordDetail 响应 |
| A3-F04 | B 用药列表（无 write 时）：只读，无代确认/编辑入口 | medList 响应 writePermissions.medicine=false |
| A3-F05 | 撤销后 B 访问家属页：拒绝/空态 | familyView allowed:false reason=revoked 响应 |

## A4 家属代录（5）

| 编号 | 场景 | 配对佐证 |
|---|---|---|
| A4-F01 | B 代录血压 128/78 成功 | records 文档：_openid=A、createdByMemberOpenId=B、createdByRole=member、source=family（掩码） |
| A4-F02 | B 代录血糖 6.4 成功 | 同上 type=bg |
| A4-F03 | B 用药代确认（已服/跳过）成功 | confirmations 文档审计字段 |
| A4-F04 | B 端无计划增删改/记录删除入口 | 页面即证 + 无新写文档（db 计数） |
| A4-F05 | A 撤销 B 后，B 代录被拒 | familyWrite.allowed=false reason 响应 |

## A6 电话提醒（8，沿用 a6 screenshot-list.md 并补真机口径）

| 编号 | 场景 | 配对佐证 |
|---|---|---|
| A6-P01 | A 授权管理页·提醒电话区（回显/保存/清空） | getFamilyAuthData 响应（号码打码归档） |
| A6-P02 | A 邀请页·电话可选+授权勾选；未勾选生成被拦截 | createFamilyInvite 载荷 |
| A6-P03 | B 家属首页·电话提醒入口（脱敏号） | homeFamily phoneReminder 字段 |
| A6-P04 | B 点击电话提醒 → **系统拨号确认界面即止，不拨出** | familyGetReminderPhone 调用时间戳（号码打码） |
| A6-P05 | A 关闭全部 remind → B 刷新无电话入口 | phoneReminder.remindAllowed=false |
| A6-P06 | read=false+remind=true：B 首页仅电话入口，无健康数据/提醒明细 | readPermissions 全 false + 二级页 scopeDenied |
| A6-P07 | A 清空电话 → B 端"未配置"状态 | phoneReminder.configured=false |
| A6-P08 | A 撤销 B → B 取号被拒提示 | phoneDenied.reason=revoked |

## A7 家庭 Tab 与开关（5）

| 编号 | 场景 | 配对佐证 |
|---|---|---|
| A7-T01 | 体验版（trial 默认开）：A 端家庭 Tab 真实页 | envVersion=trial + appConfig 响应（null 或布尔） |
| A7-T02 | 占位态（开关关）。**依赖项**：需远程配置 app_configs.familyTabEnabled=false（创建需另行授权，见 cloud-pending.md #4）或正式包 release 默认；本轮如未获授权则记录"本地已验证（A7 测试 14/14），真机占位态待正式发布验收" | 远程配置值或 release 包版本 |
| A7-T03 | 家庭页空成员状态 | family 响应 familyCount=0 |
| A7-T04 | 成员列表：待加入（预览卡无操作按钮）/已授权（管理+解除） | family 响应 members |
| A7-T05 | 加载失败态+重新加载（可用飞行模式模拟） | 失败提示与恢复后数据 |

不补拍：A2-S01、A2-S06（用户明确不提供，维持原记录）。
