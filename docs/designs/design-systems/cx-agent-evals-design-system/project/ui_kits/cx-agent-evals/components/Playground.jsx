/* global React, Dot, Button, Input, ToolGroup */
const { useState, useRef, useEffect } = React;

function Playground({ agentName }) {
  const [messages, setMessages] = useState([
    { role: 'user', content: 'Where is my order #4821?' },
    { role: 'tool_group', calls: [
      { name: 'Order Lookup', query: 'order #4821 status',
        result: 'Order #4821 shipped Apr 18 via UPS Ground, tracking 1Z9W…' },
    ]},
    { role: 'assistant', content: "Your order #4821 shipped on April 18 via UPS Ground. Tracking number 1Z9W2X — estimated delivery is tomorrow.\n\nCan I help with anything else?" },
  ]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [raw, setRaw] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || streaming) return;
    const q = input.trim();
    setInput('');
    setMessages(m => [...m, { role: 'user', content: q }]);
    setStreaming(true);
    setTimeout(() => {
      setMessages(m => [...m, { role: 'tool_group', calls: [
        { name: 'Knowledge Base', query: q, result: 'Found 3 matching articles…' },
      ]}]);
    }, 400);
    setTimeout(() => {
      setMessages(m => [...m, { role: 'assistant', content: "Let me look that up for you. Based on our knowledge base, here's what I found…" }]);
      setStreaming(false);
    }, 1600);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        padding: '10px 16px', borderBottom: '1px solid #2a2a36',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Playground · {agentName}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            display: 'inline-flex', background: '#1a1a22',
            border: '1px solid #2a2a36', borderRadius: 9999, overflow: 'hidden',
          }}>
            <button onClick={() => setRaw(false)} style={{
              padding: '2px 10px', fontSize: 10, border: 0, fontFamily: 'inherit',
              background: !raw ? 'rgba(110,231,183,.2)' : 'transparent',
              color: !raw ? '#6ee7b7' : '#8888a0', cursor: 'pointer',
            }}>Rendered</button>
            <button onClick={() => setRaw(true)} style={{
              padding: '2px 10px', fontSize: 10, border: 0, fontFamily: 'inherit',
              background: raw ? 'rgba(110,231,183,.2)' : 'transparent',
              color: raw ? '#6ee7b7' : '#8888a0', cursor: 'pointer',
            }}>Raw</button>
          </div>
          <button style={{
            fontSize: 10, color: '#55556a', background: 'transparent',
            border: 0, cursor: 'pointer', fontFamily: 'inherit',
          }}>Clear chat</button>
        </div>
      </div>

      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto', padding: 16,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        {messages.length === 0 && (
          <div style={{
            textAlign: 'center', color: '#55556a', fontSize: 12, marginTop: 48,
          }}>Send a message to start testing your agent.</div>
        )}
        {messages.map((m, i) => {
          if (m.role === 'user') return (
            <div key={i} style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{
                maxWidth: '80%', background: 'rgba(110,231,183,.1)',
                border: '1px solid rgba(110,231,183,.2)',
                borderRadius: 12, padding: '8px 12px', fontSize: 13,
              }}>{m.content}</div>
            </div>
          );
          if (m.role === 'tool_group') return (
            <ToolGroup key={i} calls={m.calls} live={false} />
          );
          if (m.role === 'assistant') return (
            <div key={i} style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{ maxWidth: '80%' }}>
                <div style={{ fontSize: 8, color: '#55556a', marginBottom: 2, marginLeft: 4 }}>Agent</div>
                <div style={{
                  background: '#141419', border: '1px solid #2a2a36',
                  borderRadius: 12, padding: '8px 12px', fontSize: 13,
                  whiteSpace: 'pre-wrap',
                }}>{m.content}</div>
              </div>
            </div>
          );
          return null;
        })}
        {streaming && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{
              background: '#141419', border: '1px solid #2a2a36',
              borderRadius: 12, padding: '8px 12px',
            }}>
              <span style={{
                display: 'inline-block', width: 6, height: 12, background: '#6ee7b7',
                borderRadius: 2, animation: 'cds-pulse-dot 1s infinite',
              }}/>
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: 12, borderTop: '1px solid #2a2a36', display: 'flex', gap: 8 }}>
        <Input
          placeholder="Type a message..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          style={{ flex: 1 }}
        />
        <Button kind="primary" size="lg" onClick={handleSend}>Send</Button>
      </div>
    </div>
  );
}

Object.assign(window, { Playground });
