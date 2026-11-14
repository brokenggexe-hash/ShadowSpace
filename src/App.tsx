import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AuthScreen } from './components/AuthScreen';
import { CalculatorGate } from './components/CalculatorGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MainLayout } from './components/MainLayout';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { RealtimeProvider } from './contexts/RealtimeContext';
import { ThemeProvider } from './contexts/ThemeContext';

function AppShell() {
  const { firebaseUser, profile, loading } = useAuth();
  const [enteredSpace, setEnteredSpace] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#111214] text-zinc-200 flex items-center justify-center gap-2.5 text-sm">
        <Loader2 className="w-5 h-5 animate-spin text-[#5865f2]" />
        <span>Loading ShadowSpace…</span>
      </div>
    );
  }

  // If user already has an active verified session, enter ShadowSpace directly;
  // otherwise start at the Calculator utility entry experience.
  if (!firebaseUser && !enteredSpace) {
    return <CalculatorGate onEnterShadowSpace={() => setEnteredSpace(true)} />;
  }

  if (!firebaseUser || !firebaseUser.emailVerified || !profile) {
    return <AuthScreen onBackToCalculator={() => setEnteredSpace(false)} />;
  }

  return <MainLayout />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <RealtimeProvider>
            <AppShell />
          </RealtimeProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
