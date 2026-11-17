# Changelog

所有迭代以本地时间记录（UTC+8）。

## [1.0.1] - 2026-11-17 21:45

### Added
- 详细 README：问题（压缩遗忘/todo 缺位/插件重叠）、途径、论文对照表、机制与实测
- 版本戳与 tag（v1.0.1-20261117-2145）

## [1.0.0] - 2026-11-17 16:50

### Added（合并首发布）
- dsh-task-state（海马体）+ dsh-task-plan（闹钟）合并为单插件
- 统一状态机（initial/latest/pendingArchive + step/todoCalls/sinceLastTodo）
- 注入优先级：P0 压缩存档（不受闹钟预算限制）> P1 todo 闹钟（预算防刷屏）

### 内部迭代时间线（合并前的演进）
- 13:30 前后 v1（dsh-task-state）：MemGPT 式压缩存档——压缩后重注入初始任务+最新指令
- 14:00 前后 v1（dsh-task-plan）：todo 闹钟 A（无单 4 步提醒）/ B（停滞 5 步提醒）——A/B 对照实测（关=未建单，开=2/2 建单）
- 16:20-16:50 合并验证：三场景连跑（S1 压缩存档/S2 无单提醒/S3 停滞提醒）全过

### 校准记录
- 审计员曾把 todo 状态更新误判为"浪费步骤"（实测 todos 每次都在真实推进——sigLen 386/390/394/392 各不同）——加入判定纪律防误伤
- 教训：**截断打印是诊断陷阱**——250 字符截断对比曾得出"第 3、4 次相同"的错误结论，完整 JSON 签名对比才是真相

[1.0.1]: https://github.com/D-al/dsh-task-continuity/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/D-al/dsh-task-continuity/releases/tag/v1.0.0
