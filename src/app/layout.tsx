import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Live Translator',
  description: 'Real-time English to Spanish live translation for events',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body style={{ margin: 0, padding: 0, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
