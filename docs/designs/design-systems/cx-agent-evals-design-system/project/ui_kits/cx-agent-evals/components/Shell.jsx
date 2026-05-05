/* global React, Dot, Icon */
const { useState } = React;

function NavPill({ mode, setMode }) {
  const items = ['knowledge', 'dataset', 'retrievers', 'agents', 'experiments'];
  const labels = {
    knowledge: 'Knowledge Base', dataset: 'Dataset',
    retrievers: 'Retrievers', agents: 'Agents', experiments: 'Experiments',
  };
  return (
    <div style={{
      display: 'inline-flex', gap: 2, background: '#0c0c0f',
      borderRadius: 6, padding: 2,
    }}>
      {items.map(k => (
        <button
          key={k}
          onClick={() => setMode(k)}
          style={{
            padding: '4px 12px', fontSize: 12, border: 0, cursor: 'pointer',
            fontFamily: 'inherit', borderRadius: 4,
            color: mode === k ? '#6ee7b7' : '#8888a0',
            background: mode === k ? '#141419' : 'transparent',
            transition: 'color 150ms ease-out',
          }}
        >{labels[k]}</button>
      ))}
    </div>
  );
}

function Shell({ mode, setMode, children }) {
  return (
    <div style={{
      minHeight: '100vh', background: '#0c0c0f', color: '#e8e8ed',
      fontFamily: 'var(--cds-font-mono)', fontSize: 13,
    }}>
      <header style={{
        borderBottom: '1px solid #2a2a36',
        background: 'rgba(20,20,25,.8)',
        backdropFilter: 'blur(6px)',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{
          maxWidth: 1280, margin: '0 auto', padding: '0 24px',
          height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button
              onClick={() => setMode('home')}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'transparent', border: 0, color: 'inherit',
                fontFamily: 'inherit', cursor: 'pointer',
              }}
            >
              <Dot size={8} />
              <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '.02em' }}>
                CX Agent Evals
              </span>
            </button>
            {mode !== 'home' && (
              <>
                <span style={{ color: '#55556a', fontSize: 11 }}>/</span>
                <NavPill mode={mode} setMode={setMode} />
              </>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11, color: '#55556a' }}>Tars · RAG Eng</span>
            <span style={{
              width: 26, height: 26, borderRadius: 9999,
              background: 'linear-gradient(135deg,#2d6b54,#6ee7b7)',
            }} />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}

Object.assign(window, { Shell });
