# dsh-task-continuity

**DeepSeek Harness（dsh）任务连续性插件** —— 海马体（P0 压缩存档）+ 前额叶闹钟（P1 todo 纪律），由两个验证成熟的插件合并而成。

## 遇到的问题

### 1. 压缩后遗忘（海马体缺位）
长会话触发上下文压缩后，实测 inputTokens 从 17976 骤降到 2679——**模型开始重复汇报、重述任务清单、忘记初始要求**。工具结果一进来，"这轮要干什么"就淡出注意力。这不是模型能力问题，是**工作上下文没有被维护**：压缩是 harness 干的，但压缩后没有人把"用户到底要什么"重新放回注意力中心。

### 2. todo 清单从不被使用（前额叶缺位）
dsh 工具面有 `todo_write`，但实测 23 步/16 步的会话里模型**从没调用过**——与社区"模型默认不主动用清单"的观察一致。没有清单 = 长任务没有外置工作记忆，"接下来该干什么"全靠模型回忆。

### 3. 两个插件职责重叠
初期分别实现为 dsh-task-state（存档）与 dsh-task-plan（闹钟）——两者事件面完全相同（session/event + agent/pre-step）、注入管线同构、职责同属"任务连续性"。分开维护导致注入优先级无法统一（压缩存档和 todo 提醒可能叠加）。

## 途径

1. **海马体：从"让模型自己记"到"harness 全自动维护"**——MemGPT 依赖强模型自主管理记忆，但本地 35B 工具调用准确率低（20+ 工具时 65~78%），**不能给它记忆管理工具** → 改为 harness 侧自动收集 + 自动注入，模型零参与
2. **存什么：只存用户真实指令**——Hippo 论文的教训：无整合的累积记忆最终低于无记忆基线 → 只收集 `source.kind === 'user'` 的真实指令，**不存模型自我总结**（避免垃圾经验污染）
3. **闹钟：外部强制 + 回灌**——Claude Code TodoWrite 实战的关键机制：清单持续出现在上下文 = 外置工作记忆；"每次更新后立刻回灌 system-reminder" + "连续 N 轮不更新就插提醒"
4. **注入优先级统一**：P0 压缩存档（不受闹钟预算限制，天然一次压缩一次）> P1 todo 闹钟（有预算防刷屏）
5. **合并验证**：合并后跑三场景连跑（压缩存档 / 无单提醒 / 停滞提醒）+ 原两插件全部行为保留

## 参考的论文与社区实践

| 来源 | 用于 |
|---|---|
| **MemGPT (arXiv 2310.08560)** | working context 概念：存"没了它下一动就做错"的事实；DMR 深度检索 32.1%→92.5% |
| **Hippo (arXiv 2610.24453)** | 无整合累积记忆最终低于无记忆基线 → 只存真实用户指令，防垃圾经验污染 |
| **initializer-plus-progress-file pattern (TMLS/Manus)** | 进度文件恢复上下文的工程模式 |
| **Plan Declaration-Execution Gap (arXiv 2609.38108)** | 声明的计划只有 22~45% 在执行中被遵守；pattern-specific executor 把 ALFWorld 0.48→0.92 → 必须外部强制执行清单纪律 |
| **CoPE (ICML 2026)** | plan-deviated trajectories 是长任务失败主因 |
| **Claude Code TodoWrite 实战（社区多篇）** | 闹钟模式：连续 N 轮不更新就插提醒 + 每次更新立刻回灌 |

## 机制与实测

| 机制 | 触发 | 实测 |
|---|---|---|
| **P0 压缩存档** | `compaction/prune` 或 `compaction/summary` → 重注入【初始任务】+【最新用户指令】 | 注入后模型不再重复汇报/重述清单；天然一次压缩只注入一次 |
| **P1-A 无单提醒** | 轮内 4 步仍无 todo_write | 2/2 检验会话 step3-4 自觉建单（阈值作为"3 步探索期+强制兜底"的平衡点） |
| **P1-B 停滞提醒** | 列单后连续 5 步未更新 | 及时更新率显著提升；连续更新被重置防轰炸 |

只存真实指令的实测细节：排除 `<system-reminder>` 包装（workspace instructions 等运行时上下文的 kind 不是 user，但做兜底过滤）。

## 解决到什么程度

- 合并版三场景连跑全过（S1 压缩存档 ✓ / S2 无单提醒 ✓ / S3 停滞提醒 ✓）
- 与 behavior-guard 组成完整链路：**预防（AGENTS.md 协议）→ 执行（本插件闹钟）→ 拦截（behavior-guard）**
- todo 纪律从"从不调用"到"2/2 会话自觉建单 + 及时更新"（AGENTS.md 协议 + 闹钟兜底的组合效果）
- 审计员判定校准后：todo 状态更新被明确排除出"浪费步骤"（防误伤）

## 配置说明

- `maxInitialChars: 2000` / `maxLatestChars: 1000`：初始任务与最新指令的存档上限
- `noTodoStepThreshold: 4` / `staleStepThreshold: 5`：A/B 闹钟阈值（3 步探索期 + 强制兜底的平衡点）
- `maxTodoInjectionsPerTurn: 1` / `maxTodoInjectionsPerSession: 4`：闹钟预算（P0 存档不受此限制）

## License
MIT
