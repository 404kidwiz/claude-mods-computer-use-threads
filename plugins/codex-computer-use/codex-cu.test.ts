import { test, expect } from 'claude-code/testing'
import { typesUnread } from './hooks/register.tsx'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

// Stands in for the engine beneath the mod: a store, a status line, a tool list
// and tool calls that just report which tool ran.
const engine = (on: On, saved?: boolean, ownProcess = false) => {
  const store = new Map<string, unknown>(saved === undefined ? [] : [['enabled', saved]])
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('tool.register', () => ({ value: undefined }))
  if (!ownProcess) on('process.run', () => ({ value: { exitCode: 0, stdout: '/tmp\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('tool.call', ($, e) => ({ result: `ran ${e.tool}`, text: `ran ${e.tool}`, isError: false }))
}

const start = { cwd: '/tmp', surface: null, isInteractive: false }

test('on by default: blocks Claude computer use, passes Codex and other tools', async ($, on) => {
  engine(on)
  await $.session.start(start)

  const own = await $.tool.call({ tool: 'mcp__computer-use__screenshot', tool_use_id: 'a' })
  expect(String(own.deny)).toContain('mcp__codex-computer-use__cua')

  const codex = await $.tool.call({ tool: 'mcp__codex-cu__js', tool_use_id: 'b', code: 'await cua.getState();' })
  expect(codex.text).toBe('ran mcp__codex-cu__js')

  const other = await $.tool.call({ tool: 'mcp__claude-in-chrome__navigate', tool_use_id: 'c', url: 'https://example.com' })
  expect(other.text).toBe('ran mcp__claude-in-chrome__navigate')
})

test('off when the person turned it off: Claude computer use runs', async ($, on) => {
  engine(on, false)
  await $.session.start(start)

  const own = await $.tool.call({ tool: 'mcp__computer-use__screenshot', tool_use_id: 'a' })
  expect(own.text).toBe('ran mcp__computer-use__screenshot')
})

test('daemon route: an unapproved app opens the approval pane; allowed apps are passed on', async ($, on) => {
  engine(on)
  const bodies: string[] = []
  const opened: string[] = []
  let declined = '["Calculator"]'
  on('mcp.call', () => ({ deny: 'not connected in this session' }))
  on('http.fetch', ($, e) => {
    if (e.url.endsWith('/health')) return { value: { status: 200, ok: true, headers: {}, text: 'ok v2' } }
    bodies.push(String(e.init?.body))
    return { value: { status: 422, ok: false, headers: { 'x-codex-declined': declined }, text: 'not approved' } }
  })
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  await $.session.start(start)

  const first = await $.tool.call({ tool: 'mcp__codex-computer-use__cua', tool_use_id: 'a', code: 'let app = await cua.getApp("Calculator");' })
  expect(first.isError).toBe(true)
  expect(String(first.text)).toContain('approval to use Calculator')
  expect(opened).toEqual(['codex-approval'])
  expect(JSON.parse(bodies[0]).approve).toEqual([])
  expect(JSON.parse(bodies[0]).session).toBe('sess-1')
  expect(JSON.parse(bodies[0]).code).toContain('Calculator')

  declined = '[]'
  const second = await $.tool.call({ tool: 'mcp__codex-computer-use__cua', tool_use_id: 'b', code: '1' })
  expect(second.text).toBe('not approved')
})

// The v2 daemon: one Codex session per Claude session and per subagent, apps leased to one session.
const daemon = (on: On, opts: { health?: string; busy?: string } = {}) => {
  const calls: { url: string; body: any }[] = []
  const runs: string[][] = []
  let health = opts.health ?? 'ok v2'
  on('mcp.call', () => ({ deny: 'not connected in this session' }))
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    // starting the daemon brings up the current version
    if (String(e.argv[2] ?? '').includes('daemon.mjs')) health = 'ok v2'
    return { value: { exitCode: 0, stdout: '/tmp\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('clock.sleep', () => ({ value: undefined }))
  on('http.fetch', ($, e) => {
    if (e.url.endsWith('/health')) return { value: { status: 200, ok: true, headers: {}, text: health } }
    calls.push({ url: e.url, body: e.init?.body ? JSON.parse(String(e.init.body)) : null })
    if (e.url.endsWith('/sessions')) {
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify([{ session: 'sess-1', busy: false, leases: ['TextEdit'], idleSeconds: 3 }, { session: 'abcdef12-other', busy: true, leases: ['Calculator'], idleSeconds: 0 }]) } }
    }
    const busy = opts.busy ?? '[]'
    return { value: { status: busy === '[]' ? 200 : 422, ok: busy === '[]', headers: { 'x-codex-declined': '[]', 'x-codex-busy': busy }, text: busy === '[]' ? 'done' : 'not approved' } }
  })
  return { calls, runs }
}

test('each session and subagent gets its own Codex session key', async ($, on) => {
  engine(on, undefined, true)
  const { calls } = daemon(on)
  await $.session.start(start)
  await $.tool.call({ tool: 'mcp__codex-computer-use__cua', tool_use_id: 'a', code: '1' })
  await $.tool.call({ tool: 'mcp__codex-computer-use__cua', tool_use_id: 'b', code: '2', agentId: 'agent-7' } as any)
  await $.tool.call({ tool: 'mcp__codex-computer-use__cua_reset', tool_use_id: 'c', agentId: 'agent-7' } as any)
  expect(calls.map(c => [c.url.replace('http://codex-cu', ''), c.body.session])).toEqual([['/js', 'sess-1'], ['/js', 'sess-1/agent-7'], ['/reset', 'sess-1/agent-7']])
  // the agent id is the key, never an argument to Codex
  expect(calls[1].body.agentId).toBeUndefined()
})

test('an app leased to another session is reported, without the approval pane', async ($, on) => {
  engine(on, undefined, true)
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  daemon(on, { busy: '[{"app":"Calculator","holder":"other","idleSeconds":12}]' })
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'mcp__codex-computer-use__cua', tool_use_id: 'a', code: 'let app = await cua.getApp("Calculator");' })
  expect(r.isError).toBe(true)
  expect(String(r.text)).toContain('Calculator is being driven by another Claude session right now (its last call was 12s ago)')
  expect(opened).toEqual([])
})

test('an older daemon is replaced before the first call', async ($, on) => {
  engine(on, undefined, true)
  const { runs, calls } = daemon(on, { health: 'ok' })
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'mcp__codex-computer-use__cua', tool_use_id: 'a', code: '1' })
  expect(r.text).toBe('done')
  expect(runs.some(a => a[0] === 'pkill' && String(a[2]).endsWith('/.claude/mcp/codex-cu/daemon.mjs'))).toBe(true)
  expect(runs.some(a => String(a[2] ?? '').includes('nohup'))).toBe(true)
  expect(calls[0].body.session).toBe('sess-1')
})

test('session end frees its Codex sessions; status lists who holds which app', async ($, on) => {
  engine(on, undefined, true)
  const { calls } = daemon(on)
  on('tool.list', () => ({ value: [] }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  await $.session.start(start)
  const status = await $.command.run({ command: 'codex-cu', args: 'status', origin: { kind: 'composer' } } as any)
  expect(String(status.text)).toContain('Chats using it now (each with its own Codex session): this chat idle 3s, holds TextEdit; abcdef12 working, holds Calculator.')
  await $.session.end({ reason: 'exit', sessionId: 'sess-1', resume: {} } as any)
  expect(calls.at(-1)).toEqual({ url: 'http://codex-cu/end', body: { session: 'sess-1' } })
})


test('a call that types before reading the state is refused; reading first, or not typing, passes', () => {
  expect(typesUnread('await app.typeText("hi")')).toBe(true)
  expect(typesUnread('await app.pressKey("cmd+n"); await app.getAXState()')).toBe(true)
  expect(typesUnread('await app.getAXState({ emit: false }); await app.typeText("hi")')).toBe(false)
  expect(typesUnread('let app = await cua.getApp("TextEdit"); await app.pressKey("cmd+n")')).toBe(false)
  expect(typesUnread('await app.click(12); await app.getAXState()')).toBe(false)
  expect(typesUnread(undefined)).toBe(false)
})

test('a shortcut can move focus, so typing after it needs a fresh read', () => {
  const opened = 'let app = await cua.getApp("TextEdit"); await app.pressKey("cmd+n");'
  expect(typesUnread(`${opened} await app.typeText("hi")`)).toBe(true)
  expect(typesUnread(`${opened} await app.getAXState({ emit: false }); await app.typeText("hi")`)).toBe(false)
  expect(typesUnread('await app.getAXState(); await app.typeText("hi"); await app.pressKey("Return"); await app.typeText("more")')).toBe(false)
  expect(typesUnread('await tab.getAXState(); await tab.pressKey(4, "ctrl+a"); await tab.typeText(4, "x")')).toBe(true)
})

test('the raw Codex tool is denied when it types unread', async ($, on) => {
  engine(on)
  await $.session.start(start)
  const blind = await $.tool.call({ tool: 'mcp__codex-cu__js', tool_use_id: 'd', code: 'await app.typeText("x")' })
  expect(String(blind.deny)).toContain('types or presses keys before reading')
  const looked = await $.tool.call({ tool: 'mcp__codex-cu__js', tool_use_id: 'e', code: 'await app.getAXState(); await app.typeText("x")' })
  expect(looked.text).toBe('ran mcp__codex-cu__js')
})

// The approval pane, on the two surfaces the mod is used from. The kit hands back the drawn tree
// as data, not a paint, so these check what the tree asks each surface to draw.
const SURFACES = ['terminal', 'desktop'] as const
const PLUGIN = 'codex-computer-use'
const PANE = 'codex-approval'
const paneProps = (bodyColumns = 60) =>
  ({ title: 'Codex computer use', isFocused: true, bodyColumns, placement: 'inline', scroll: { offset: 0, bodyRows: 8 }, view: {} }) as const

// An approval waiting for Calculator: the bridge call the daemon declined opens the pane. The
// effects a press has outside the pane (panes closed, files written, prompts sent) are recorded;
// `retry` repeats the call and says which apps the mod then told the daemon were allowed, the
// session's `allowed` list as the daemon sees it.
const awaiting = async ($: Engine, on: On, title?: string) => {
  engine(on)
  const bodies: any[] = []
  const closed: string[] = []
  const writes: { path: string; text: string }[] = []
  const prompts: { text: string; asUser: boolean }[] = []
  on('mcp.call', () => ({ deny: 'not connected in this session' }))
  on('http.fetch', ($, e) => {
    if (e.url.endsWith('/health')) return { value: { status: 200, ok: true, headers: {}, text: 'ok v2' } }
    const body = JSON.parse(String(e.init?.body))
    bodies.push(body)
    // like the daemon: Calculator is declined until it is among the apps the mod approves
    const isApproved: boolean = body.approve.includes('Calculator')
    const headers: Record<string, string> = isApproved ? {} : { 'x-codex-declined': '["Calculator"]' }
    return { value: { status: isApproved ? 200 : 422, ok: isApproved, headers, text: isApproved ? 'done' : 'not approved' } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', ($, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('fs.read', () => ({ value: JSON.stringify({ apps: ['Notes'], autoApproveAll: false }) }))
  on('fs.write', ($, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('prompt.submit', ($, e) => {
    prompts.push({ text: e.text, asUser: (e.origin as { asUser?: boolean }).asUser === true })
    return { text: e.text }
  })
  await $.session.start(start)
  const call = { tool: 'mcp__codex-computer-use__cua', tool_use_id: 'a', code: 'let app = await cua.getApp("Calculator"); app.click(3)' }
  const run = () => $.tool.call((title === undefined ? call : { ...call, title }) as any)
  await run()
  const retry = async () => {
    await run()
    return bodies.at(-1).approve as string[]
  }

  return { bodies, closed, writes, prompts, retry }
}

const mountPane = ($: Engine, surface: (typeof SURFACES)[number], bodyColumns?: number) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: paneProps(bodyColumns) })

// The tree as indented text: each element with its props, a Text with what it shows.
const dump = (node: any, depth = 0): string => {
  const props = Object.entries(node.props ?? {}).map(([k, v]) => (v === true ? k : `${k}=${v}`))
  const text = (node.children ?? []).filter((c: unknown) => typeof c === 'string').join('')
  const line = `${'  '.repeat(depth)}${[node.type, ...props].join(' ')}${text === '' ? '' : `: ${text}`}`
  const kids = (node.children ?? []).filter((c: unknown) => typeof c !== 'string').map((c: unknown) => dump(c, depth + 1))

  return [line, ...kids].join('\n')
}

const COPY = 'Codex clicks and types in Calculator in the background. Undo an always-allow with /codex-cu forget Calculator.'
const DUMPS = {
  terminal: `Box flexDirection=column gap=1
  Box flexDirection=column
    Text bold: Allow Codex to use Calculator?
    Text wrap=truncate-end: Wants to: Add 2 + 2 in Calculator
  Text dimColor: ${COPY}
  Box gap=2 flexWrap=wrap
    Button key=allow label=Allow in this chat hotkey=a plain variant=primary autoFocus
    Button key=always label=Always allow hotkey=l plain
    Button key=deny label=Deny hotkey=d plain role=dismiss`,
  desktop: `Box flexDirection=column gap=1
  Box flexDirection=column
    Text bold: Allow Codex to use Calculator?
    Text wrap=truncate-end: Wants to: Add 2 + 2 in Calculator
  Text dimColor: ${COPY}
  Box gap=2 flexWrap=wrap
    Button key=allow label=Allow in this chat hotkey=a variant=primary autoFocus
    Button key=always label=Always allow hotkey=l
    Button key=deny label=Deny hotkey=d role=dismiss`,
}

for (const surface of SURFACES) {
  test(`${surface}: a titled approval says what is about to happen, and the choices carry their keys`, async ($, on) => {
    await awaiting($, on, 'Add 2 + 2 in Calculator')
    const ui = await mountPane($, surface)

    expect(dump(await ui.drawn())).toBe(DUMPS[surface])
    expect((await ui.find({ type: 'Text', text: 'Allow Codex to use Calculator?' }))?.props.bold).toBe(true)
    expect((await ui.find({ type: 'Text', text: 'Wants to: Add 2 + 2 in Calculator' }))?.text).toBe('Wants to: Add 2 + 2 in Calculator')

    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map(b => [b.key, b.props.label, b.props.hotkey])).toEqual([
      ['allow', 'Allow in this chat', 'a'],
      ['always', 'Always allow', 'l'],
      ['deny', 'Deny', 'd'],
    ])
    expect(buttons.filter(b => b.props.variant === 'primary').map(b => b.key)).toEqual(['allow'])
    expect(buttons.filter(b => b.props.autoFocus === true).map(b => b.key)).toEqual(['allow'])
    expect((await ui.find({ key: 'deny' }))?.props.role).toBe('dismiss')
    // the terminal draws `[ label ]` without the hotkey unless the Button is plain (`a: label`)
    expect(buttons.map(b => b.props.plain === true)).toEqual(surface === 'terminal' ? [true, true, true] : [false, false, false])
  })

  test(`${surface}: with no title there is no "Wants to" line, and the code is never shown`, async ($, on) => {
    await awaiting($, on)
    const ui = await mountPane($, surface)

    expect(await ui.find({ text: /Wants to/ })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: 'Allow Codex to use Calculator?' }))?.props.bold).toBe(true)
    expect(dump(await ui.drawn())).not.toContain('getApp')
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(3)
  })

  test(`${surface}: the title stays on one line, within the pane`, async ($, on) => {
    await awaiting($, on, '  Open\n  a new   document in TextEdit and type the quarterly summary into it  ')
    const ui = await mountPane($, surface, 40)
    const wants = (await ui.find({ type: 'Text', text: /^Wants to:/ }))?.text ?? ''
    expect(wants).toBe('Wants to: Open a new document in TextEd…')
    expect(wants).toHaveLength(40)
    expect(wants).not.toContain('\n')
  })

  test(`${surface}: allow keeps the app for this chat, clears the ask, closes the pane and asks Claude to retry`, async ($, on) => {
    const { closed, writes, prompts, retry } = await awaiting($, on, 'Add 2 + 2 in Calculator')
    const ui = await mountPane($, surface)
    await ui.press({ key: 'allow' })

    expect((await ui.find({ type: 'Text' }))?.text).toBe('No approval waiting.')
    expect(closed).toEqual([PANE])
    expect(writes).toEqual([])
    expect(prompts).toEqual([{ text: 'I allowed Codex computer use to use Calculator for this chat. Retry the last call and continue the task.', asUser: true }])
    expect(await retry()).toEqual(['Calculator'])
  })

  test(`${surface}: always allow also keeps the app in the standing list, beside the apps already there`, async ($, on) => {
    const { closed, writes, prompts, retry } = await awaiting($, on)
    const ui = await mountPane($, surface)
    await ui.press({ key: 'always' })

    expect((await ui.find({ type: 'Text' }))?.text).toBe('No approval waiting.')
    expect(closed).toEqual([PANE])
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0]?.text ?? '')).toEqual({ apps: ['Notes', 'Calculator'], autoApproveAll: false })
    // the standing list lives here; /codex-cu forget, which the pane names, edits this file
    expect(writes[0]?.path).toBe('/tmp/.claude/mcp/codex-cu/always-allowed.json')
    expect(prompts).toEqual([{ text: 'I always allowed Codex computer use to use Calculator. Retry the last call and continue the task.', asUser: true }])
    expect(await retry()).toEqual(['Calculator'])
  })

  test(`${surface}: deny keeps the app out, clears the ask, closes the pane and tells Claude to stop`, async ($, on) => {
    const { closed, writes, prompts, retry } = await awaiting($, on, 'Add 2 + 2 in Calculator')
    const ui = await mountPane($, surface)
    await ui.press({ key: 'deny' })

    expect((await ui.find({ type: 'Text' }))?.text).toBe('No approval waiting.')
    expect(closed).toEqual([PANE])
    expect(writes).toEqual([])
    expect(prompts).toEqual([{ text: 'I denied Codex computer use for Calculator. Do not use Calculator; tell me another way or stop.', asUser: true }])
    expect(await retry()).toEqual([])
  })

  test(`${surface}: with nothing to approve the pane says so, dim`, async ($, on) => {
    engine(on)
    await $.session.start(start)
    const ui = await mountPane($, surface)

    const empty = await ui.find({ type: 'Text' })
    expect(empty?.text).toBe('No approval waiting.')
    expect(empty?.props.dimColor).toBe(true)
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  })
}
