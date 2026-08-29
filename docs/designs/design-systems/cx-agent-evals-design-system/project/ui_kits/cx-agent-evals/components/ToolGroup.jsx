/* global React */
const { useState } = React;

function ToolChip({ name, query, result }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ marginBottom: 6 }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: '#141419', border: '1px solid #2a2a36',
          borderRadius: 6, padding: '4px 10px',
          fontFamily: 'inherit', fontSize: 9, color: '#8888a0', cursor: 'pointer',
        }}
      >
        <span style={{ color: '#6ee7b7' }}>⚡</span>
        <span>Searched <strong style={{ color: '#e8e8ed', fontWeight: 500 }}>{name}</strong></span>
        <span style={{ color: '#55556a' }}>{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div style={{
          marginTop: 4, marginLeft: 8, padding: 10,
          background: '#141419', border: '1px solid #2a2a36', borderRadius: 6,
          fontSize: 9, animation: 'cds-fade-in 300ms ease-out both',
        }}>
          <div style={{ marginBottom: 8 }}>
            <span style={{ color: '#55556a' }}>Query: </span>
            <span style={{ color: '#e8e8ed' }}>"{query}"</span>
          </div>
          <div style={{ color: '#55556a', marginBottom: 6 }}>1 chunk returned</div>
          <div style={{
            padding: 6, background: '#0c0c0f',
            border: '1px solid rgba(42,42,54,.5)', borderRadius: 4,
            color: '#8888a0', lineHeight: 1.4,
          }}>{result}</div>
        </div>
      )}
    </div>
  );
}

function ToolGroup({ calls, live }) {
  const [expanded, setExpanded] = useState(false);
  const last = calls[calls.length - 1];
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
      <div style={{ maxWidth: '80%' }}>
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: '#141419', border: '1px solid #2a2a36',
            borderRadius: 8, padding: '6px 10px',
            fontFamily: 'inherit', fontSize: 10, color: '#8888a0', cursor: 'pointer',
          }}
        >
          <span style={{ color: '#6ee7b7' }}>⚡</span>
          {live ? (
            <span>Calling <strong style={{ color: '#e8e8ed', fontWeight: 500 }}>{last.name}</strong>
              <span style={{
                display: 'inline-block', width: 4, height: 4, borderRadius: 9999,
                background: '#6ee7b7', marginLeft: 4, verticalAlign: 'middle',
                animation: 'cds-pulse-dot 1s infinite',
              }}/>
            </span>
          ) : (
            <span><strong style={{ color: '#e8e8ed', fontWeight: 500 }}>{calls.length}</strong> tool{calls.length !== 1 ? 's' : ''} called</span>
          )}
          <span style={{ color: '#55556a', marginLeft: 2 }}>{expanded ? '▾' : '▸'}</span>
        </button>
        {expanded && (
          <div style={{ marginTop: 4, marginLeft: 8 }}>
            {calls.map((c, i) => (
              <ToolChip key={i} name={c.name} query={c.query} result={c.result} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { ToolGroup, ToolChip });
