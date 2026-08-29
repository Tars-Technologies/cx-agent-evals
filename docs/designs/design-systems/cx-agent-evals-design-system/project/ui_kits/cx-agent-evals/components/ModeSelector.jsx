/* global React, Icon */

const MODES = [
  { key: 'knowledge', title: 'Knowledge Base', icon: 'database',
    body: 'Create and manage knowledge bases. Upload documents, import from URLs, and organize your data.',
    trail: ['Create KB', 'Upload docs', 'Import URLs'] },
  { key: 'dataset', title: 'Dataset', icon: 'question',
    body: 'Create and curate evaluation datasets with ground truth spans for RAG retrieval testing',
    trail: ['Generate questions', 'Edit & curate', 'Ground truth spans'] },
  { key: 'retrievers', title: 'Retrievers', icon: 'cylinder',
    body: 'Configure, index, and test retrieval pipelines against your knowledge bases',
    trail: ['Select KB', 'Configure & index', 'Test & compare'] },
  { key: 'agents', title: 'Agents', icon: 'chat',
    body: 'Create CX agents with custom prompts and retriever tools. Test them in a live playground.',
    trail: ['Create agent', 'Add tools', 'Test & iterate'] },
  { key: 'experiments', title: 'Run Experiments', icon: 'chart',
    body: 'Run retrieval experiments on LangSmith datasets and compare results across configurations',
    trail: ['Select retriever', 'Select dataset', 'Run & analyze'] },
];

function ModeCard({ mode, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer',
        padding: 32, borderRadius: 8,
        background: hover ? 'rgba(20,20,25,.8)' : '#141419',
        border: `1px solid ${hover ? 'rgba(110,231,183,.5)' : '#2a2a36'}`,
        transition: 'all 200ms ease-out',
        display: 'flex', flexDirection: 'column', gap: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 8,
          background: hover ? 'rgba(110,231,183,.2)' : 'rgba(110,231,183,.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 200ms ease-out',
        }}>
          <Icon name={mode.icon} size={20} color="#6ee7b7" stroke={mode.icon === 'chat' ? 1.5 : 2} />
        </div>
        <h2 style={{
          margin: 0, fontSize: 18, fontWeight: 500,
          color: hover ? '#6ee7b7' : '#e8e8ed',
          transition: 'color 200ms ease-out',
        }}>{mode.title}</h2>
      </div>
      <p style={{
        margin: 0, fontSize: 13, color: '#8888a0', lineHeight: 1.6,
      }}>{mode.body}</p>
      <div style={{
        marginTop: 24, fontSize: 11, color: '#55556a',
        display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
      }}>
        {mode.trail.map((step, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ color: '#2a2a36' }}>→</span>}
            <span>{step}</span>
          </React.Fragment>
        ))}
      </div>
    </button>
  );
}

function ModeSelector({ onPick }) {
  return (
    <div style={{
      minHeight: 'calc(100vh - 56px)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 48,
    }}>
      <div style={{ maxWidth: 1400, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 12, marginBottom: 16,
          }}>
            <Dot size={12} />
            <h1 style={{
              margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '.02em',
            }}>CX Agent Evals</h1>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: '#8888a0' }}>
            Build and Evaluate CX AI Agents
          </p>
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 24,
        }}>
          {MODES.map(m => (
            <ModeCard key={m.key} mode={m} onClick={() => onPick(m.key)} />
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ModeSelector });
