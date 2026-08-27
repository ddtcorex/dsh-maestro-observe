import * as React from 'react'

export default {
  inject: ['connection', 'slots'],
  apply(ctx) {
    const CHANNEL = '/maestro/observe'
    const call = (req) => ctx.connection.rpc.call(CHANNEL, req)
    const fmt = (n) => (n ?? 0).toLocaleString('en-US')

    function Readout(props) {
      const { useState, useEffect } = React
      const [cost, setCost] = useState(null)
      const [errors, setErrors] = useState(0)
      const sessionId = props?.sessionId ?? props?.session?.id
      useEffect(() => {
        let alive = true
        const tick = () => call({ method: 'cost', scope: 'session', sessionId }).then((res) => {
          if (!alive) return
          if (res?.ok) setCost(res.cost)
          call({ method: 'trace', limit: 50 }).then((t) => { if (alive) setErrors(t?.ok ? t.records.filter((r) => r.isError).length : 0) }).catch(() => {})
        }).catch(() => {})
        tick()
        const id = setInterval(tick, 30000)
        return () => { alive = false; clearInterval(id) }
      }, [sessionId])
      const total = cost ? (cost.inputTokens ?? 0) + (cost.outputTokens ?? 0) : 0
      return React.createElement('span', { style: { fontSize: 12, opacity: 0.7, marginLeft: 8 } },
        `${cost?.turns ?? 0} turns \u00B7 ${fmt(total)} tok${errors ? ` \u00B7 \u26A0 ${errors}` : ''}`)
    }

    function Dashboard(_props) {
      const { useState, useEffect } = React
      const [state, setState] = useState({ cost: null, trace: [], health: null })
      useEffect(() => {
        let alive = true
        const tick = () => Promise.all([
          call({ method: 'cost', scope: 'day' }),
          call({ method: 'trace', limit: 50 }),
          call({ method: 'health' }),
        ]).then(([c, t, h]) => { if (alive) setState({ cost: c?.ok ? c.cost : null, trace: t?.ok ? t.records : [], health: h?.ok ? h.health : null }) }).catch(() => {})
        tick()
        const id = setInterval(tick, 30000)
        return () => { alive = false; clearInterval(id) }
      }, [])
      const c = state.cost
      const total = c ? (c.inputTokens ?? 0) + (c.outputTokens ?? 0) + (c.cacheReadTokens ?? 0) + (c.cacheWriteTokens ?? 0) : 0
      const row = (r) => React.createElement('tr', { key: r.ts + '-' + (r.tool ?? r.kind) },
        React.createElement('td', null, new Date(r.ts).toLocaleTimeString()),
        React.createElement('td', null, r.kind),
        React.createElement('td', null, r.tool ?? ''),
        React.createElement('td', null, r.latencyMs != null ? `${r.latencyMs}ms` : ''),
        React.createElement('td', null, r.isError ? '\u26A0' : ''))
      return React.createElement('div', { style: { padding: 16 } },
        React.createElement('h3', null, 'Observe'),
        React.createElement('p', null, `Today: ${c?.turns ?? 0} turns \u00B7 ${fmt(total)} tokens`),
        React.createElement('p', null, state.health ? `uptime ${Math.round(state.health.uptimeMs / 60000)}m \u00B7 ${state.health.toolCount} tools \u00B7 ${state.health.plugins.length} plugins${state.health.degraded?.length ? ` \u00B7 \u26A0 degraded ${state.health.degraded.length}` : ''}` : 'health \u2026'),
        state.health?.degraded?.length ? React.createElement('ul', { style: { fontSize: 11, color: '#b00', margin: '4px 0' } }, state.health.degraded.map((d) => React.createElement('li', { key: d.id }, `${d.id}: ${d.error}`))) : null,
        React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
          React.createElement('thead', null, React.createElement('tr', null,
            React.createElement('th', null, 'time'), React.createElement('th', null, 'kind'), React.createElement('th', null, 'tool'), React.createElement('th', null, 'lat'), React.createElement('th', null, 'err'))),
          React.createElement('tbody', null, state.trace.slice(0, 50).map(row))))
    }

    ctx.effect(() => ctx.slots.inject('settings.section', { id: 'observe', order: 27, label: () => 'Observe', render: Dashboard }))
    ctx.effect(() => ctx.slots.inject('conversation.composer.dock', { id: 'observe-readout', order: 1, label: () => 'observe', render: Readout }))
  },
}
