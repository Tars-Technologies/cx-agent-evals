/* global React, Dot, Icon, StatusPill, MetaTag, Button, Input */
const { useState, useRef, useEffect } = React;

const SAMPLE_AGENTS = [
  { id: 'a1', name: 'Support Agent', model: 'sonnet-4', retrievers: 3, status: 'ready' },
  { id: 'a2', name: 'Billing Agent', model: 'sonnet-4', retrievers: 1, status: 'indexing' },
  { id: 'a3', name: 'Onboarding Bot', model: 'haiku-4', retrievers: 2, status: 'ready' },
  { id: 'a4', name: 'Returns Handler', model: 'sonnet-4', retrievers: 0, status: 'error' },
];

function Sidebar({ agents, selectedId, onSelect, onCreate }) {
  return (
    <div style={{
      width: 220, background: '#141419', borderRight: '1px solid #2a2a36',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
    }}>
      <div style={{
        padding: 12, borderBottom: '1px solid #2a2a36',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{
          color: '#8888a0', fontSize: 10,
          textTransform: 'uppercase', letterSpacing: '.12em',
        }}>Agents</span>
        <Button kind="primary" size="xs" onClick={onCreate}>+ New</Button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {agents.map(a => {
          const selected = a.id === selectedId;
          return (
            <button
              key={a.id}
              onClick={() => onSelect(a.id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                background: selected ? '#1a1a22' : 'transparent',
                border: 0, borderLeft: `3px solid ${selected ? '#6ee7b7' : 'transparent'}`,
                borderRadius: 6, padding: '10px 10px 10px 8px',
                marginBottom: 2, cursor: 'pointer',
                fontFamily: 'inherit', transition: 'background 150ms ease-out',
              }}
            >
              <div style={{
                fontSize: 11, fontWeight: 500,
                color: selected ? '#e8e8ed' : '#8888a0',
              }}>{a.name}</div>
              <div style={{ fontSize: 9, color: '#55556a', marginTop: 2 }}>{a.model}</div>
              <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                <MetaTag>{a.retrievers} retriever{a.retrievers !== 1 ? 's' : ''}</MetaTag>
                <StatusPill status={a.status} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { Sidebar, SAMPLE_AGENTS });
