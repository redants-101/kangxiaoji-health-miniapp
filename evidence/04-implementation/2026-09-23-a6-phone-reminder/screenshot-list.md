# A6 截图清单（本轮不拍摄；部署 + 真机验证后补）

前置：A4/A5/A6 云函数部署 + 体验版上传（含本批页面），账号 A=owner、B=家属（remind=true）。

| 编号 | 场景 | 预期画面 | 配对佐证 |
|---|---|---|---|
| A6-P01 | A 授权管理页·提醒电话区 | 输入框回显完整号 + 脱敏说明文案 + 保存/清空按钮 | getFamilyAuthData 响应（contactPhone/contactPhoneMasked） |
| A6-P02 | A 邀请页·电话可选区 | 电话输入 + 授权勾选 + 文案；未勾选生成被拦截 toast | createFamilyInvite 请求载荷 |
| A6-P03 | B 家属首页·电话提醒入口 | section 显示"提醒电话 138****1234"+ 电话提醒按钮 | getHomeFamilyData 响应 phoneReminder（无完整号） |
| A6-P04 | B 点击电话提醒 | 系统拨号盘唤起（显示完整号，属平台行为） | familyGetReminderPhone 响应时间戳（号码打码归档） |
| A6-P05 | A 关闭全部 remind → B 刷新 | 电话提醒 section 消失，无按钮 | getHomeFamilyData phoneReminder.remindAllowed=false |
| A6-P06 | read=false+remind=true → B 首页 | 仅电话提醒入口；无最新记录/今日用药/周报/快捷查看 | 响应 readPermissions 全 false + 二级页 scopeDenied |
| A6-P07 | A 清空电话 → B 刷新 | "家人尚未配置提醒电话"状态 | phoneReminder.configured=false |
| A6-P08 | A 撤销 B → B 点电话提醒 | 拒绝提示"家属授权已解除"，未拨出 | phoneDenied.reason=revoked 响应 |

截图不单独证明隐私口径；完整号码不出现在任何归档响应/日志中（归档前打码核对）。
