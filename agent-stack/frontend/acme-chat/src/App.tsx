import React, { useState, useEffect } from 'react';
import './App.css';
import AuthService, { User } from './services/AuthService';
import ChatInterface from './components/ChatInterface';
import Header from './components/Header';
import LoginForm from './components/LoginForm';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check for existing session on mount
    const checkSession = async () => {
      try {
        const currentUser = await AuthService.getCurrentUser();
        setUser(currentUser);
      } catch (err) {
        console.error('Failed to get current user:', err);
      }
      setLoading(false);
    };

    checkSession();
  }, []);

  useEffect(() => {
    // Add/remove login-page class to body for aurora background
    if (!user && !loading) {
      document.body.classList.add('login-page');
    } else {
      document.body.classList.remove('login-page');
    }

    // Cleanup on unmount
    return () => {
      document.body.classList.remove('login-page');
    };
  }, [user, loading]);

  const handleLogin = async (username: string, password: string) => {
    setError(null);
    setLoading(true);
    try {
      const authenticatedUser = await AuthService.loginWithCredentials(username, password);
      setUser(authenticatedUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      setError(null);
      await AuthService.signOut();
      setUser(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logout failed');
      console.error('Logout failed:', err);
    }
  };

  if (loading) {
    return (
      <div className="app">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading Agent Interoperability Demo...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Header user={user} onLogout={handleLogout} />

      <main className="main-content">
        {!user ? (
          <>
            {error && (
              <div className="auth-error-banner">
                <p>⚠️ {error}</p>
              </div>
            )}
            <LoginForm onLogin={handleLogin} loading={loading} />
          </>
        ) : (
          <ChatInterface user={user} />
        )}
      </main>
    </div>
  );
}

export default App;
