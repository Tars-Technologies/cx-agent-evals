/* global React, Button, StatusPill, Icon */
const { useState } = React;

const RUNS = [
  { id: 'r1', retriever: 'hybrid-kb-01', model: 'bge-large', k: 5, recall: 0.92, precision: 0.81, f1: 0.86, iou: 0.74, status: 'ready', ts: '2h ago' },
  { id: 'r2', retriever: 'bm25-baseline', model: 'bm25',      k: 5, recall: 0.68, precision: 0.72, f1: 0.70, iou: 0.55, status: 'ready', ts: '3h ago' },
  { id: 'r3', retriever: 'dense-v2',      model: 'openai-3',  k: 10, recall: 0.88, precision: 0.64, f1: 0.74, iou: 0.59, status: 'ready', ts: '1d ago' },
  { id: 'r4', retriever: 'rerank-exp',    model: 'bge + cohere', k: 10, recall: 0.95, precision: 0.85, f1: 0.90, iou: 0.78, status: 'indexing', ts: 'now' },
];

function MetricCell({ value, best }) {
  const pct = Math.round(value * 100);
  const color = best ? '#6ee7b7' : '#e8e8ed';
  return (
    <div>
      <div style={{ fontSize: 12, color, fontWeight: best ? 600 : 400 }}>{pct}%</div>
      <div style={{
        marginTop: 4, height: 3, borderRadius: 2,
        background: 'rgba(255,255,255,.05)', overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: best ? '#6ee7b7' : '#8888a0',
        }} />
      </div>
    </div>
  );
}

function ExperimentsScreen() {
  const bestRecall = Math.max(...RUNS.map(r => r.recall));
  const bestF1 = Math.max(...RUNS.map(r => r.f1));

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 20,
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Run Experiments</h1>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#8888a0' }}>
            Compare retriever configurations against the <span style={{ color: '#a7f3d0', background: '#1a1a22', padding: '1px 6px', borderRadius: 4 }}>support-eval-v3</span> dataset.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button kind="secondary" size="md">Filter</Button>
          <Button kind="primary" size="md">+ New Run</Button>
        </div>
      </div>

      {/* Meta row */}
      <div style={{
        display: 'flex', gap: 24, padding: '12px 16px',
        background: '#141419', border: '1px solid #2a2a36', borderRadius: 8,
        marginBottom: 20, fontSize: 11, color: '#8888a0',
      }}>
        <div>Dataset: <span style={{ color: '#e8e8ed' }}>support-eval-v3</span></div>
        <div>·</div>
        <div>48 questions</div>
        <div>·</div>
        <div>4 runs</div>
        <div>·</div>
        <div>last run: <span style={{ color: '#e8e8ed' }}>2h ago</span></div>
      </div>

      {/* Run table */}
      <div style={{
        background: '#141419', border: '1px solid #2a2a36',
        borderRadius: 8, overflow: 'hidden',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '40px 2fr 1.5fr 60px 1fr 1fr 1fr 1fr 100px',
          gap: 12, padding: '10px 16px',
          borderBottom: '1px solid #2a2a36',
          fontSize: 9, color: '#55556a',
          textTransform: 'uppercase', letterSpacing: '.12em',
        }}>
          <span></span>
          <span>Retriever</span>
          <span>Model</span>
          <span>k</span>
          <span>Recall</span>
          <span>Precision</span>
          <span>F1</span>
          <span>IoU</span>
          <span>Status</span>
        </div>
        {RUNS.map(r => (
          <div key={r.id} style={{
            display: 'grid',
            gridTemplateColumns: '40px 2fr 1.5fr 60px 1fr 1fr 1fr 1fr 100px',
            gap: 12, padding: '14px 16px',
            borderBottom: '1px solid #2a2a36',
            alignItems: 'center', fontSize: 12,
            transition: 'background 150ms ease-out',
          }}>
            <input type="checkbox" style={{ accentColor: '#6ee7b7' }} />
            <span style={{ color: '#e8e8ed' }}>{r.retriever}</span>
            <span style={{ color: '#8888a0' }}>{r.model}</span>
            <span style={{ color: '#8888a0' }}>{r.k}</span>
            <MetricCell value={r.recall} best={r.recall === bestRecall} />
            <MetricCell value={r.precision} />
            <MetricCell value={r.f1} best={r.f1 === bestF1} />
            <MetricCell value={r.iou} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StatusPill status={r.status} />
              <span style={{ fontSize: 9, color: '#55556a' }}>{r.ts}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{
        marginTop: 16, fontSize: 10, color: '#55556a',
        display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <span>Select retriever</span>
        <span style={{ color: '#2a2a36' }}>→</span>
        <span>Select dataset</span>
        <span style={{ color: '#2a2a36' }}>→</span>
        <span>Run &amp; analyze</span>
      </div>
    </div>
  );
}

Object.assign(window, { ExperimentsScreen });
