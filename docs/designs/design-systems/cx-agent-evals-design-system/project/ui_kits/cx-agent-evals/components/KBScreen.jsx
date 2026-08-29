/* global React, Button, StatusPill, MetaTag */
const { useState } = React;

const KBS = [
  { id: 'k1', name: 'Support Docs', docs: 142, chunks: 2104, status: 'ready' },
  { id: 'k2', name: 'Billing FAQ', docs: 36, chunks: 412, status: 'ready' },
  { id: 'k3', name: 'Product Manual', docs: 8, chunks: 980, status: 'indexing' },
];

const DOC = {
  title: 'Returns & Refunds Policy',
  id: 'doc-0312',
  body: [
    { text: "You can return most items within 30 days of delivery for a full refund. ", chunk: 0 },
    { text: "Items must be unused and in original packaging. ", chunk: 1 },
    { text: "Shipping labels are provided free of charge for domestic returns. ", chunk: 1 },
    { text: "Refunds are processed within 5–7 business days after we receive the item. ", chunk: 2 },
    { text: "For damaged or defective items, contact support within 48 hours of delivery. ", chunk: 3 },
    { text: "International orders are subject to customs fees which are non-refundable. ", chunk: 4 },
  ],
};

const CHUNK_COLORS = ['#6ee7b780', '#818cf880', '#fbbf2480', '#f472b680', '#38bdf880'];

function KBScreen() {
  const [selected, setSelected] = useState('k1');
  const [highlightChunk, setHighlightChunk] = useState(null);

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 56px)', minHeight: 0 }}>
      {/* KB list */}
      <div style={{
        width: 220, background: '#141419', borderRight: '1px solid #2a2a36',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: 12, borderBottom: '1px solid #2a2a36',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ color: '#8888a0', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.12em' }}>
            Knowledge Bases
          </span>
          <Button kind="primary" size="xs">+ New</Button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {KBS.map(kb => {
            const sel = kb.id === selected;
            return (
              <button key={kb.id} onClick={() => setSelected(kb.id)} style={{
                display: 'block', width: '100%', textAlign: 'left',
                background: sel ? '#1a1a22' : 'transparent',
                border: 0, borderLeft: `3px solid ${sel ? '#6ee7b7' : 'transparent'}`,
                borderRadius: 6, padding: '10px 10px 10px 8px',
                marginBottom: 2, cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: sel ? '#e8e8ed' : '#8888a0' }}>{kb.name}</div>
                <div style={{ fontSize: 9, color: '#55556a', marginTop: 2 }}>{kb.docs} docs · {kb.chunks} chunks</div>
                <div style={{ marginTop: 6 }}><StatusPill status={kb.status} /></div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Doc viewer */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{
          padding: '10px 16px', borderBottom: '1px solid #2a2a36',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{DOC.title}</div>
            <div style={{ fontSize: 10, color: '#55556a', marginTop: 2 }}>{DOC.id} · 5 chunks</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button kind="secondary" size="sm">Reindex</Button>
            <Button kind="secondary" size="sm">Edit</Button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 24, fontSize: 13, lineHeight: 1.8 }}>
          {DOC.body.map((seg, i) => (
            <span key={i} style={{
              background: highlightChunk === seg.chunk ? CHUNK_COLORS[seg.chunk] : 'transparent',
              borderRadius: 2, padding: '1px 0',
              transition: 'background 150ms ease-out',
            }}>{seg.text}</span>
          ))}
        </div>
      </div>

      {/* Chunks rail */}
      <div style={{
        width: 280, background: '#141419', borderLeft: '1px solid #2a2a36',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: 12, borderBottom: '1px solid #2a2a36',
          color: '#8888a0', fontSize: 10,
          textTransform: 'uppercase', letterSpacing: '.12em',
        }}>Chunks</div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
          {[0,1,2,3,4].map(i => (
            <div key={i}
              onMouseEnter={() => setHighlightChunk(i)}
              onMouseLeave={() => setHighlightChunk(null)}
              style={{
                background: '#0c0c0f', border: '1px solid #2a2a36', borderRadius: 8,
                padding: 10, marginBottom: 8, cursor: 'pointer',
                borderColor: highlightChunk === i ? 'rgba(110,231,183,.5)' : '#2a2a36',
                transition: 'border-color 150ms ease-out',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: CHUNK_COLORS[i] }}/>
                <span style={{ fontSize: 10, color: '#55556a' }}>#{i+1} · score: 0.{92 - i*7}</span>
              </div>
              <div style={{ fontSize: 11, color: '#8888a0', lineHeight: 1.5 }}>
                {DOC.body.filter(s => s.chunk === i).map(s => s.text).join('').slice(0, 80)}…
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { KBScreen });
