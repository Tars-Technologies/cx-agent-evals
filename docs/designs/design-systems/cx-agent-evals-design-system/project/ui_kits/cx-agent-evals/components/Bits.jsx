/* global React */
const { useState, useEffect } = React;

/* ── Dot: the brand heartbeat ────────────────────────────────── */
function Dot({ size = 8, color = '#6ee7b7', pulse = true, glow = false }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: 9999,
        background: color,
        animation: pulse ? 'cds-pulse-dot 1.4s ease-in-out infinite' : 'none',
        boxShadow: glow ? '0 0 12px rgba(110,231,183,.4)' : 'none',
        flexShrink: 0,
      }}
    />
  );
}

/* ── Heroicons outline (inline SVG) ──────────────────────────── */
const ICON_PATHS = {
  database: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
  question: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  cylinder: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4",
  chat: "M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z",
  chart: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  trash: "m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0",
  plus: "M12 4.5v15m7.5-7.5h-15",
  send: "M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5",
};

function Icon({ name, size = 20, color = 'currentColor', stroke = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/* ── Chips ──────────────────────────────────────────────────── */
function StatusPill({ status }) {
  const map = {
    ready:    { fg: '#6ee7b7', bg: 'rgba(110,231,183,.1)' },
    indexing: { fg: '#fbbf24', bg: 'rgba(251,191,36,.1)' },
    error:    { fg: '#f87171', bg: 'rgba(248,113,113,.1)' },
    pending:  { fg: '#8888a0', bg: 'rgba(136,136,160,.1)' },
  };
  const c = map[status] ?? map.pending;
  return (
    <span style={{
      fontSize: 9, padding: '1px 8px', borderRadius: 9999,
      color: c.fg, background: c.bg,
    }}>{status}</span>
  );
}

function MetaTag({ children }) {
  return (
    <span style={{
      fontSize: 8, padding: '1px 6px', borderRadius: 4,
      color: '#8888a0', background: '#141419',
    }}>{children}</span>
  );
}

/* ── Button ─────────────────────────────────────────────────── */
function Button({ kind = 'primary', size = 'md', children, style, ...rest }) {
  const styles = {
    primary:     { background: '#6ee7b7', color: '#0c0c0f', border: 0 },
    secondary:   { background: 'transparent', color: '#e8e8ed', border: '1px solid #2a2a36' },
    ghost:       { background: 'transparent', color: '#8888a0', border: 0 },
    danger:      { background: '#f87171', color: '#fff', border: 0 },
    'danger-disabled': { background: '#2a2a36', color: '#55556a', border: 0, cursor: 'not-allowed' },
  };
  const sizes = {
    xs: { padding: '2px 10px', fontSize: 10, borderRadius: 4 },
    sm: { padding: '4px 12px', fontSize: 11, borderRadius: 6 },
    md: { padding: '6px 14px', fontSize: 12, borderRadius: 6 },
    lg: { padding: '8px 16px', fontSize: 13, borderRadius: 8 },
  };
  return (
    <button
      style={{
        fontFamily: 'inherit', fontWeight: 500, cursor: 'pointer',
        transition: 'all 150ms ease-out',
        ...styles[kind], ...sizes[size], ...style,
      }}
      {...rest}
    >{children}</button>
  );
}

/* ── Input ──────────────────────────────────────────────────── */
function Input({ focused = false, style, ...rest }) {
  return (
    <input
      style={{
        background: '#1a1a22',
        border: `1px solid ${focused ? 'rgba(110,231,183,.5)' : '#2a2a36'}`,
        color: '#e8e8ed',
        fontFamily: 'inherit',
        fontSize: 13,
        padding: '8px 12px',
        borderRadius: 8,
        outline: 0,
        ...style,
      }}
      {...rest}
    />
  );
}

Object.assign(window, { Dot, Icon, StatusPill, MetaTag, Button, Input });
