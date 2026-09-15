import * as React from 'react'

export function apply(ctx) {
  const slots = ctx.get?.('slots') ?? ctx.slots
  if (!slots) return
  const connection = ctx.get?.('connection') ?? ctx.connection
  if (!connection) return
  {
    const CHANNEL = '/dsh-maestro-observe'
    const call = (req) => connection.rpc.call(CHANNEL, req)
    const fmt = (n) => (n ?? 0).toLocaleString('en-US')
    const totalOf = (c) => (c ? (c.inputTokens ?? 0) + (c.outputTokens ?? 0) + (c.cacheReadTokens ?? 0) + (c.cacheWriteTokens ?? 0) : 0)

    const T = {
      text: { color: 'var(--dsw-alias-text-primary)' },
      subtle: { color: 'var(--dsw-alias-text-secondary)' },
      panel: { padding: 16, color: 'var(--dsw-alias-text-primary)' },
      tab: (active) => ({
        padding: '8px 12px',
        minHeight: 40,
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 8,
        background: active ? 'var(--dsw-alias-brand-primary)' : 'transparent',
        color: 'var(--dsw-alias-text-primary)',
      }),
      table: { width: '100%', borderCollapse: 'collapse', fontSize: 12, color: 'var(--dsw-alias-text-primary)' },
    }

    function Readout(props) {
      const { useState, useEffect } = React
      const [cost, setCost] = useState(null)
      const [errors, setErrors] = useState(0)
      const sessionId = props?.sessionId ?? props?.session?.id
      useEffect(() => {
        if (!sessionId) return undefined
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
      if (!sessionId) return null
      const total = totalOf(cost)
      return React.createElement('span', { style: { fontSize: 12, opacity: 0.7, marginLeft: 8, color: 'var(--dsw-alias-text-secondary)' } },
        `${cost?.turns ?? 0} turns · ${fmt(total)} tok${errors ? ` · ⚠ ${errors}` : ''}`)
    }

    const TABS = [
      { id: 'cost', label: 'Cost' },
      { id: 'errors', label: 'Errors' },
      { id: 'latency', label: 'Latency' },
      { id: 'health', label: 'Health' },
    ]

    function Dashboard(_props) {
      const { useState, useEffect } = React
      const [tab, setTab] = useState('cost')
      const [cost, setCost] = useState(null)
      const [groups, setGroups] = useState([])
      const [errors, setErrors] = useState([])
      const [latency, setLatency] = useState(null)
      const [health, setHealth] = useState(null)
      useEffect(() => {
        let alive = true
        const tick = async () => {
          try {
            if (tab === 'cost') {
              const [c, g] = await Promise.all([
                call({ method: 'cost', scope: 'day' }),
                call({ method: 'cost', scope: 'day', groupBy: 'tool' }),
              ])
              if (!alive) return
              if (c?.ok) setCost(c.cost)
              if (g?.ok) setGroups(g.groups ?? [])
            } else if (tab === 'errors') {
              const e = await call({ method: 'errors' })
              if (alive && e?.ok) setErrors(e.groups ?? [])
            } else if (tab === 'latency') {
              const l = await call({ method: 'latency' })
              if (alive && l?.ok) setLatency(l.latency)
            } else {
              const h = await call({ method: 'health' })
              if (alive && h?.ok) setHealth(h.health)
            }
          } catch { /* keep last good state */ }
        }
        tick()
        const id = setInterval(tick, 30000)
        return () => { alive = false; clearInterval(id) }
      }, [tab])

      const tabBar = React.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: 12 }, role: 'tablist' },
        TABS.map((t) => React.createElement('button', {
          key: t.id,
          'data-testid': `observe-tab-${t.id}`,
          role: 'tab',
          'aria-selected': tab === t.id,
          onClick: () => setTab(t.id),
          style: T.tab(tab === t.id),
        }, t.label)))

      let panel = null
      if (tab === 'cost') {
        panel = React.createElement('div', { 'data-testid': 'observe-panel-cost' },
          React.createElement('p', { style: T.subtle }, `Today: ${cost?.turns ?? 0} turns · ${fmt(totalOf(cost))} tokens`),
          React.createElement('table', { style: T.table },
            React.createElement('thead', null, React.createElement('tr', null,
              React.createElement('th', null, 'tool'), React.createElement('th', null, 'tokens'))),
            React.createElement('tbody', null, groups.slice(0, 20).map((g, i) =>
              React.createElement('tr', { key: `${g.key}-${i}` },
                React.createElement('td', null, g.key),
                React.createElement('td', null, fmt(totalOf(g.agg))))))))
      } else if (tab === 'errors') {
        panel = React.createElement('div', { 'data-testid': 'observe-panel-errors' },
          React.createElement('table', { style: T.table },
            React.createElement('thead', null, React.createElement('tr', null,
              React.createElement('th', null, 'tool'), React.createElement('th', null, 'signature'),
              React.createElement('th', null, 'count'), React.createElement('th', null, 'last'))),
            React.createElement('tbody', null, errors.slice(0, 50).map((e, i) =>
              React.createElement('tr', { key: `${e.tool}-${e.signature}-${i}` },
                React.createElement('td', null, e.tool),
                React.createElement('td', null, e.signature),
                React.createElement('td', null, e.count),
                React.createElement('td', null, new Date(e.lastTs).toLocaleTimeString()))))))
      } else if (tab === 'latency') {
        panel = React.createElement('div', { 'data-testid': 'observe-panel-latency' },
          latency
            ? React.createElement('p', { style: T.subtle }, `n=${latency.count} · p50 ${latency.p50}ms · p95 ${latency.p95}ms · p99 ${latency.p99}ms`)
            : React.createElement('p', { style: T.subtle }, 'latency …'))
      } else {
        panel = React.createElement('div', { 'data-testid': 'observe-panel-health' },
          health
            ? React.createElement('div', null,
              React.createElement('p', { style: T.subtle },
                `uptime ${Math.round(health.uptimeMs / 60000)}m · ${health.toolCount} tools · ${health.plugins.length} plugins${health.degraded?.length ? ` · ⚠ degraded ${health.degraded.length}` : ''}`),
              health.degraded?.length ? React.createElement('ul', { style: { fontSize: 11, fontWeight: 'bold', margin: '4px 0', color: 'var(--dsw-alias-text-primary)' } },
                health.degraded.map((d, i) => React.createElement('li', { key: `${d.id}-${i}` }, `${d.id}: ${d.error}`))) : null)
            : React.createElement('p', { style: T.subtle }, 'health …'))
      }

      return React.createElement('div', { style: T.panel },
        React.createElement('h3', { style: T.text }, 'Observe'),
        tabBar,
        panel)
    }

    ctx.effect(() => {
      const dispose = slots.inject('settings.section', () =>
        slots.register(
          { name: 'settings.section', id: 'observe', order: 27, label: () => 'Observe' },
          Dashboard,
        ))
      return () => { try { dispose?.() } catch {} }
    })
    ctx.effect(() => {
      const dispose = slots.inject('conversation.composer.dock', () =>
        slots.register(
          { name: 'conversation.composer.dock', id: 'observe-readout', order: 1, label: () => 'observe' },
          Readout,
        ))
      return () => { try { dispose?.() } catch {} }
    })
  }
}

export default { apply }
