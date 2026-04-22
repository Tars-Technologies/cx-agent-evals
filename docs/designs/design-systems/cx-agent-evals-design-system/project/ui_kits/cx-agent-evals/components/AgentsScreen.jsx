/* global React, Sidebar, Playground, SAMPLE_AGENTS */
const { useState } = React;

function AgentsScreen() {
  const [agents, setAgents] = useState(SAMPLE_AGENTS);
  const [selectedId, setSelectedId] = useState(SAMPLE_AGENTS[0].id);

  const handleCreate = () => {
    const id = 'a' + (agents.length + 1);
    const next = { id, name: 'New Agent', model: 'sonnet-4', retrievers: 0, status: 'pending' };
    setAgents([...agents, next]);
    setSelectedId(id);
  };

  const selected = agents.find(a => a.id === selectedId);

  return (
    <div style={{
      display: 'flex', height: 'calc(100vh - 56px)', minHeight: 0,
    }}>
      <Sidebar
        agents={agents}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreate={handleCreate}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {selected ? (
          <Playground agentName={selected.name} />
        ) : (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#55556a', fontSize: 13,
          }}>Select an agent to test.</div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { AgentsScreen });
