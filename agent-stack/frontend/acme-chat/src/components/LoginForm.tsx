import React, { useState } from 'react';

interface LoginFormProps {
  onLogin: (username: string, password: string) => void;
  loading: boolean;
}

const LoginForm: React.FC<LoginFormProps> = ({ onLogin, loading }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim() && password.trim()) {
      onLogin(username.trim(), password);
    }
  };


  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h2>🔐 Sign In</h2>
          <p>Connect to your AI assistant powered by Amazon Bedrock AgentCore</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="username">Email/Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your email or username"
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div className="password-input">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                disabled={loading}
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                disabled={loading}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          <button 
            type="submit" 
            className="login-button"
            disabled={loading || !username.trim() || !password.trim()}
          >
            {loading ? (
              <>
                <div className="button-spinner"></div>
                Signing In...
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>


        <div className="auth-info">
          <p>🔒 Authentication powered by Amazon Cognito</p>
          <p>🚀 AI responses from Amazon Bedrock AgentCore</p>
        </div>
      </div>
    </div>
  );
};

export default LoginForm;