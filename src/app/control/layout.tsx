import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Live Translator - Control Panel',
  description: 'Operator control panel for the live translation system.',
};

export default function ControlLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
