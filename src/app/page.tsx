import Link from 'next/link';

export default function HomePage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        padding: '2rem',
      }}
    >
      <h1 style={{ fontSize: '3rem', marginBottom: '0.5rem', fontWeight: 700 }}>
        Live Translator
      </h1>
      <p style={{ fontSize: '1.2rem', color: '#a0a0b0', marginBottom: '3rem' }}>
        Real-time English → Spanish subtitles for live events
      </p>

      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link
          href="/display"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '2rem 3rem',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '16px',
            textDecoration: 'none',
            color: '#fff',
            transition: 'all 0.2s',
          }}
        >
          <span style={{ fontSize: '3rem', marginBottom: '1rem' }}>🖥️</span>
          <span style={{ fontSize: '1.4rem', fontWeight: 600 }}>Display</span>
          <span style={{ fontSize: '0.9rem', color: '#888', marginTop: '0.5rem' }}>
            Fullscreen subtitle view
          </span>
        </Link>

        <Link
          href="/control"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '2rem 3rem',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '16px',
            textDecoration: 'none',
            color: '#fff',
            transition: 'all 0.2s',
          }}
        >
          <span style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎛️</span>
          <span style={{ fontSize: '1.4rem', fontWeight: 600 }}>Control Panel</span>
          <span style={{ fontSize: '0.9rem', color: '#888', marginTop: '0.5rem' }}>
            Operator dashboard
          </span>
        </Link>
      </div>

      <p style={{ marginTop: '3rem', fontSize: '0.85rem', color: '#555' }}>
        Innovaitors SAS — Medellín, Colombia
      </p>
    </div>
  );
}
