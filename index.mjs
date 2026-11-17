/**
 * dsh-task-continuity —— 任务连续性（task-state 海马体 + task-plan 前额叶闹钟 合并版）
 * （2026-11-17 第二轮剃刀：两插件事件面完全相同（session/event + agent/pre-step），
 *   职责同属"任务连续性"，合并后共享状态收集与注入管线，注入优先级统一调度）
 *
 * P0 压缩存档（原 task-state）：compaction 后重注入任务状态，防止遗忘
 *   依据：MemGPT (2310.08560) working context；Hippo (2610.24453) 只存真实指令；
 *   initializer-plus-progress-file (TMLS/Manus)
 * P1 todo 闹钟（原 task-plan）：清单纪律执行器
 *   依据：Plan Declaration-Execution Gap (2609.38108)；Claude Code TodoWrite 闹钟模式；
 *   CoPE (ICML 2026) plan deviation
 *
 * 注入优先级：压缩存档（P0，不受闹钟预算限制，天然一次压缩一次）> todo 闹钟（P1，有预算）
 */

import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

export const name = 'task-continuity'

const DEFAULTS = {
  enabled: true,
  // ── P0 压缩存档 ──
  maxInitialChars: 2000,
  maxLatestChars: 1000,
  archiveHeader: '[harness 任务存档] 本会话经历压缩，为防止遗忘，以下是自动维护的任务状态，以此为准：',
  // ── P1 todo 闹钟 ──
  noTodoStepThreshold: 4,
  staleStepThreshold: 5,
  maxTodoInjectionsPerTurn: 1,
  maxTodoInjectionsPerSession: 4,
  messageNoTodo: '[harness 执行检查] 这是一个多步任务，但你还没有用 todo_write 建立任务清单。立即停下：先调用 todo_write 写出完整步骤清单（每条 = 动词 + 目标 + 完成标准，末尾加 [VERIFY] 验证项），把第一项标为 in_progress，然后按清单顺序执行。',
  messageStale: '[harness 执行检查] 你已经连续多步没有更新 todo 清单了。立即回到清单：把刚完成的项标为 completed，把下一项标为 in_progress，再继续执行。如果发现实际工作与清单偏离，先修订清单再继续。',
  probePath: ''
}

function normalizeConfig(raw) {
  const cfg = { ...DEFAULTS }
  if (!raw || typeof raw !== 'object') return cfg
  if (typeof raw.enabled === 'boolean') cfg.enabled = raw.enabled
  for (const k of ['maxInitialChars', 'maxLatestChars', 'noTodoStepThreshold', 'staleStepThreshold',
    'maxTodoInjectionsPerTurn', 'maxTodoInjectionsPerSession']) {
    if (Number.isInteger(raw[k]) && raw[k] > 0) cfg[k] = raw[k]
  }
  for (const k of ['archiveHeader', 'messageNoTodo', 'messageStale', 'probePath']) {
    if (typeof raw[k] === 'string') cfg[k] = raw[k]
  }
  return cfg
}

function createMessage(text, kind) {
  return Object.freeze({
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind },
    id: randomUUID()
  })
}

function textOf(message) {
  const c = message?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n')
  return ''
}

function withMessage(decision, text, kind) {
  const msg = createMessage(text, kind)
  const messages = Array.isArray(decision?.messages) ? [...decision.messages, msg] : [msg]
  return { ...decision, messages }
}

export function apply(ctx, config) {
  const cfg = normalizeConfig(config)
  if (!cfg.enabled) return

  const info = (t) => { try { ctx.logger?.info?.(t) } catch { /* ignore */ } }
  const warn = (t) => { try { ctx.logger?.warn?.(t) } catch { /* ignore */ } }
  info(`task-continuity: 已加载（P0 压缩存档 + P1 todo 闹钟：无单阈值 ${cfg.noTodoStepThreshold} / 停滞 ${cfg.staleStepThreshold}）`)

  if (cfg.probePath) {
    try { writeFileSync(cfg.probePath, JSON.stringify({ loadedAt: new Date().toISOString(), config: cfg }, null, 2)) }
    catch (e) { warn(`task-continuity: 探针失败 ${String(e)}`) }
  }

  /** sessionId -> 统一状态 */
  const states = new Map()
  let sessionTodoInjections = 0

  function stateOf(id) {
    let s = states.get(id)
    if (!s) {
      s = {
        // P0 压缩存档
        initial: '', latest: '', pendingArchive: false,
        // P1 todo 闹钟
        step: 0, todoCalls: 0, sinceLastTodo: 0,
        turnTodoInjections: 0, remindedNoTodo: false
      }
      states.set(id, s)
    }
    return s
  }

  ctx.on('session/event', (session, event) => {
    try {
      if (!session || !event) return
      const s = stateOf(session.id)

      // ── P0 收集真实用户指令 ──
      if (event.type === 'user/message' && event.data?.source?.kind === 'user') {
        const t = textOf(event.data).trim()
        if (t && !t.startsWith('<system-reminder>')) {
          if (!s.initial) s.initial = t.slice(0, cfg.maxInitialChars)
          s.latest = t.slice(0, cfg.maxLatestChars)
        }
        return
      }

      // ── P0 压缩动作 → 重注入 ──
      if (event.type === 'compaction/prune' || event.type === 'compaction/summary') {
        s.pendingArchive = true
        return
      }

      // ── P1 闹钟计数 ──
      if (event.type === 'turn/start') {
        s.turnTodoInjections = 0
        s.remindedNoTodo = false
        s.step = 0
        return
      }
      if (event.type === 'step/end') {
        s.step += 1
        s.sinceLastTodo += 1
        return
      }
      if (event.type === 'tool/call') {
        if (String(event.data?.name ?? '') === 'todo_write') {
          s.todoCalls += 1
          s.sinceLastTodo = 0
        }
        return
      }
    } catch (error) {
      warn(`task-continuity: session/event 失败 ${String(error)}`)
    }
  })

  ctx.on('agent/pre-step', async ({ agent } = {}, next) => {
    const decision = await next()
    try {
      if (!agent) return decision
      const s = stateOf(agent.session?.id)

      // ── P0：压缩存档（最高优先级，天然一次压缩一次，不受闹钟预算限制）──
      if (s.pendingArchive && s.initial) {
        const parts = [cfg.archiveHeader]
        parts.push(`【初始任务】${s.initial}`)
        if (s.latest && s.latest !== s.initial) parts.push(`【最新用户指令】${s.latest}`)
        s.pendingArchive = false
        info(`task-continuity: 压缩后重注入任务存档（初始 ${s.initial.length} 字 + 最新 ${s.latest.length} 字）`)
        return withMessage(decision, parts.join('\n'), 'task-continuity')
      }

      // ── P1：todo 闹钟（A 无单 / B 停滞）──
      if (s.turnTodoInjections >= cfg.maxTodoInjectionsPerTurn) return decision
      if (sessionTodoInjections >= cfg.maxTodoInjectionsPerSession) return decision

      let text = ''
      if (s.todoCalls === 0 && s.step >= cfg.noTodoStepThreshold && !s.remindedNoTodo) {
        text = cfg.messageNoTodo
        s.remindedNoTodo = true
      } else if (s.todoCalls > 0 && s.sinceLastTodo >= cfg.staleStepThreshold) {
        text = cfg.messageStale
        s.sinceLastTodo = 0
      } else {
        return decision
      }

      s.turnTodoInjections += 1
      sessionTodoInjections += 1
      info(`task-continuity: todo 闹钟注入 todoCalls=${s.todoCalls} step=${s.step} sinceLastTodo=${s.sinceLastTodo}`)

      if (cfg.probePath) {
        try {
          const fp = cfg.probePath.replace('loaded.json', 'trace.txt')
          writeFileSync(fp, `todo alarm injected at step=${s.step} todoCalls=${s.todoCalls}\n`)
        } catch { /* ignore */ }
      }
      return withMessage(decision, text, 'task-continuity')
    } catch (error) {
      warn(`task-continuity: pre-step 失败 ${String(error)}`)
      return decision
    }
  })
}
