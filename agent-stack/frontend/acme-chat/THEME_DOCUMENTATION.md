# ACME Chat Theme & Design System

A comprehensive guide to the ACME Chat application's visual design system, featuring a futuristic dark theme with green accent colors and terminal/hacker aesthetics.

## 🎨 Visual Identity Overview

**Theme Concept:** Futuristic tech/cyberpunk aesthetic with dark backgrounds, bright green accents, and terminal-inspired typography.

**Primary Use Case:** AI-powered chat application for corporate/enterprise environment

**Aesthetic Keywords:** Professional, high-tech, cyberpunk, terminal, Matrix-inspired, clean, modern

## 📋 Color Palette

### Core Colors

```css
/* Background Colors */
--bg-primary: #0a0a0a;           /* Main background - deep black */
--bg-secondary: #1a1a1a;         /* Card/container backgrounds */
--bg-tertiary: #2a2a2a;          /* Input fields, secondary elements */
--bg-quaternary: #3a3a3a;        /* Hover states, code blocks */

/* Accent Colors */
--accent-primary: #00ff00;       /* Main brand green - bright lime */
--accent-secondary: #00ff88;     /* Lighter green for subtitles/labels */
--accent-tertiary: #22d3ee;      /* Cyan for streaming indicators */

/* Text Colors */
--text-primary: #ffffff;         /* Primary text - pure white */
--text-secondary: #cccccc;       /* Secondary text - light gray */
--text-tertiary: #888888;       /* Muted text - medium gray */
--text-quaternary: #718096;      /* Subtle text - darker gray */

/* Border Colors */
--border-primary: #00ff00;       /* Accent borders */
--border-secondary: #444444;     /* Subtle borders */
--border-tertiary: #666666;      /* Lighter borders */

/* Status Colors */
--success: #00ff00;              /* Success/connected state */
--warning: #ffff00;              /* Warning/testing state */
--error: #ff6666;                /* Error/danger state */
--info: #4a4aff;                 /* Info/user message state */
```

### Color Usage Guidelines

1. **#0a0a0a (Deep Black)** - Main application background
2. **#1a1a1a (Dark Gray)** - Cards, containers, header backgrounds
3. **#00ff00 (Bright Green)** - Primary accent, buttons, borders, success states
4. **#ffffff (White)** - Primary text, high contrast elements
5. **#00ff88 (Light Green)** - Secondary accents, subtitles
6. **#ff6666 (Red)** - Error states, logout buttons, warnings

## 🔤 Typography System

### Font Families

```css
/* Primary Font Stack */
font-family: 'Consolas', 'Monaco', 'Courier New', monospace;

/* Fallback System Fonts */
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
  'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;

/* Code Font */
font-family: source-code-pro, Menlo, Monaco, Consolas, 'Courier New', monospace;
```

### Typography Scale

```css
/* Headings */
.app-title {
  font-size: 1.8rem;      /* 28.8px */
  font-weight: 700;
  color: #00ff00;
  text-shadow: 0 0 10px rgba(0, 255, 0, 0.3);
}

.login-header h2 {
  font-size: 1.5rem;      /* 24px */
  font-weight: 600;
  color: #00ff00;
  text-shadow: 0 0 10px rgba(0, 255, 0, 0.3);
}

/* Body Text */
.app-subtitle {
  font-size: 0.9rem;      /* 14.4px */
  color: #00ff88;
}

.user-name {
  font-size: 0.9rem;      /* 14.4px */
  font-weight: 600;
  color: #ffffff;
}

.message-content {
  font-size: 1rem;        /* 16px */
  line-height: 1.5;
  color: #ffffff;
}

/* Small Text */
.message-time {
  font-size: 0.7rem;      /* 11.2px */
  color: #888888;
}

.input-hint {
  font-size: 0.8rem;      /* 12.8px */
  color: #888888;
}
```

### Text Effects

```css
/* Glow Effect for Titles */
text-shadow: 0 0 10px rgba(0, 255, 0, 0.3);

/* Terminal Cursor Animation */
.terminal-cursor {
  color: #00ff00;
  animation: cursorBlink 1s infinite;
}

@keyframes cursorBlink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}
```

## 🏗️ Layout & Spacing System

### Container Structure

```css
/* Main App Layout */
.app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

/* Header */
.app-header {
  background: #1a1a1a;
  padding: 1rem 2rem;
  border-bottom: 1px solid #00ff00;
  box-shadow: 0 2px 10px rgba(0, 255, 0, 0.1);
}

/* Main Content Area */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 2rem;
}
```

### Spacing Scale

```css
/* Spacing Variables */
--space-xs: 0.25rem;     /* 4px */
--space-sm: 0.5rem;      /* 8px */
--space-md: 1rem;        /* 16px */
--space-lg: 1.5rem;      /* 24px */
--space-xl: 2rem;        /* 32px */
--space-2xl: 2.5rem;     /* 40px */
--space-3xl: 3rem;       /* 48px */
```

### Border Radius System

```css
--radius-sm: 4px;        /* Small elements */
--radius-md: 8px;        /* Input fields, buttons */
--radius-lg: 12px;       /* Message bubbles */
--radius-xl: 16px;       /* Cards, containers */
--radius-full: 50%;      /* Circular elements */
```

## 🎛️ Component Patterns

### Button System

#### Primary Button (Green Accent)
```css
.login-button, .send-button {
  background: transparent;
  color: #00ff00;
  border: 2px solid #00ff00;
  border-radius: 8px;
  padding: 0.75rem 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
}

.login-button:hover:not(:disabled) {
  background: #00ff00;
  color: #0a0a0a;
  transform: translateY(-2px);
  box-shadow: 0 0 20px rgba(0, 255, 0, 0.5);
}
```

#### Danger Button (Red)
```css
.logout-button {
  background: transparent;
  color: #ff6666;
  border: 1px solid #ff6666;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.logout-button:hover {
  background: #ff6666;
  color: #0a0a0a;
  transform: translateY(-1px);
  box-shadow: 0 0 15px rgba(255, 102, 102, 0.5);
}
```

### Input System

```css
.form-group input, .message-input {
  background: #2a2a2a;
  color: #ffffff;
  border: 2px solid #444444;
  border-radius: 8px;
  padding: 0.75rem;
  font-size: 1rem;
  font-family: inherit;
  transition: border-color 0.2s;
}

.form-group input:focus, .message-input:focus {
  outline: none;
  border-color: #00ff00;
  box-shadow: 0 0 10px rgba(0, 255, 0, 0.3);
}
```

### Card System

```css
.login-card, .chat-container {
  background: #1a1a1a;
  border: 1px solid #00ff00;
  border-radius: 16px;
  box-shadow: 0 0 30px rgba(0, 255, 0, 0.2);
}

.login-card {
  padding: 2rem;
  max-width: 400px;
}

.chat-container {
  height: 85vh;
  box-shadow: 0 0 40px rgba(0, 255, 0, 0.1);
}
```

### Message System

```css
/* User Messages */
.message.user .message-content {
  background: #2a2a4a;
  color: white;
  border: 1px solid #4a4aff;
  border-bottom-right-radius: 4px;
  padding: 1rem;
  border-radius: 12px;
}

/* Assistant Messages */
.message.assistant .message-content {
  background: #2a2a2a;
  color: #ffffff;
  border: 1px solid #444444;
  border-bottom-left-radius: 4px;
  padding: 1rem;
  border-radius: 12px;
}

/* Streaming Messages */
.message.assistant.streaming .message-content {
  border: 1px solid #00ff00;
  box-shadow: 0 0 10px rgba(0, 255, 0, 0.1);
}
```

## ✨ Animation & Effects

### Loading Animations

```css
/* Spinner Animation */
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.loading-spinner, .button-spinner {
  border: 4px solid rgba(255, 255, 255, 0.3);
  border-left: 4px solid white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

/* Typing Indicator */
@keyframes typing {
  0%, 80%, 100% {
    transform: scale(0);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

.typing-dots span {
  width: 6px;
  height: 6px;
  background: #718096;
  border-radius: 50%;
  animation: typing 1.4s infinite ease-in-out;
}
```

### Hover Effects

```css
/* Button Hover */
.login-button:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 0 20px rgba(0, 255, 0, 0.5);
}

/* Image Hover */
.message-image:hover {
  transform: scale(1.02);
  cursor: pointer;
}
```

### Status Indicators

```css
.status-indicator.connected {
  background: #002a00;
  color: #00ff00;
  border: 1px solid #00ff00;
}

.status-indicator.testing {
  background: #2a2a00;
  color: #ffff00;
  border: 1px solid #ffff00;
}

.status-indicator.error {
  background: #2a0000;
  color: #ff6666;
  border: 1px solid #ff6666;
}
```

## 📱 Responsive Design

### Breakpoints

```css
/* Mobile First Approach */
@media (max-width: 768px) {
  .main-content {
    padding: 0.5rem;
  }
  
  .app-header {
    padding: 1rem;
  }
  
  .header-content {
    flex-direction: column;
    gap: 1rem;
    align-items: center;
  }
  
  .chat-container {
    height: 80vh;
    border-radius: 8px;
  }
  
  .message {
    max-width: 98%;
  }
}
```

## 🌟 Special Features

### Aurora Background (Login Page)

```css
body.login-page {
  background: linear-gradient(rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0.6)), 
              url('https://d3dh52mpp8dm84.cloudfront.net/aurora-bg.jpg');
  background-size: cover;
  background-position: center;
  background-attachment: fixed;
  background-repeat: no-repeat;
}
```

### Chart/Image Display

```css
.message-image-container {
  margin: 1rem 0;
  padding: 0.5rem;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  text-align: center;
}

.message-image {
  max-width: 100%;
  max-height: 500px;
  height: auto;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s ease;
}
```

### Loading Skeletons

```css
.chart-skeleton {
  display: flex;
  align-items: end;
  gap: 8px;
  height: 120px;
  margin-bottom: 1rem;
}

.skeleton-bar {
  width: 40px;
  background: linear-gradient(90deg, 
    rgba(255, 255, 255, 0.1) 0%, 
    rgba(255, 255, 255, 0.2) 50%, 
    rgba(255, 255, 255, 0.1) 100%);
  border-radius: 4px;
  animation: chartShimmer 2s ease-in-out infinite;
}

@keyframes chartShimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
```

## 🔧 Implementation Guide

### CSS Custom Properties Setup

```css
:root {
  /* Colors */
  --bg-primary: #0a0a0a;
  --bg-secondary: #1a1a1a;
  --bg-tertiary: #2a2a2a;
  --accent-primary: #00ff00;
  --accent-secondary: #00ff88;
  --text-primary: #ffffff;
  --text-secondary: #cccccc;
  --border-primary: #00ff00;
  --border-secondary: #444444;
  
  /* Typography */
  --font-family-mono: 'Consolas', 'Monaco', 'Courier New', monospace;
  --font-size-xs: 0.7rem;
  --font-size-sm: 0.8rem;
  --font-size-base: 1rem;
  --font-size-lg: 1.2rem;
  --font-size-xl: 1.5rem;
  --font-size-2xl: 1.8rem;
  
  /* Spacing */
  --space-xs: 0.25rem;
  --space-sm: 0.5rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2rem;
  
  /* Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  
  /* Effects */
  --shadow-glow-green: 0 0 10px rgba(0, 255, 0, 0.3);
  --shadow-glow-green-strong: 0 0 20px rgba(0, 255, 0, 0.5);
  --transition-fast: all 0.2s;
}
```

### Global Styles

```css
/* Reset */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: var(--font-family-mono);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background: var(--bg-primary);
  color: var(--text-primary);
  min-height: 100vh;
}

/* Selection */
::selection {
  background: var(--accent-primary);
  color: var(--bg-primary);
}

/* Scrollbar */
::-webkit-scrollbar {
  width: 8px;
}

::-webkit-scrollbar-track {
  background: var(--bg-secondary);
}

::-webkit-scrollbar-thumb {
  background: var(--border-secondary);
  border-radius: var(--radius-sm);
}

::-webkit-scrollbar-thumb:hover {
  background: var(--accent-primary);
}
```

## 🚀 Technology Stack

### Dependencies
```json
{
  "react": "^19.1.1",
  "react-dom": "^19.1.1",
  "typescript": "^4.9.5",
  "amazon-cognito-identity-js": "^6.3.15",
  "axios": "^1.11.0"
}
```

### Key Features
- **Framework:** React 19 with TypeScript
- **Authentication:** Amazon Cognito
- **HTTP Client:** Axios
- **Styling:** Pure CSS with CSS Custom Properties
- **Typography:** Monospace fonts for terminal aesthetic
- **Icons:** Unicode emoji characters for simplicity

## 🎯 Usage Examples

### Creating a New Button

```css
.my-button {
  background: transparent;
  color: var(--accent-primary);
  border: 2px solid var(--accent-primary);
  border-radius: var(--radius-md);
  padding: var(--space-md) var(--space-lg);
  font-weight: 600;
  cursor: pointer;
  transition: var(--transition-fast);
  font-family: var(--font-family-mono);
}

.my-button:hover:not(:disabled) {
  background: var(--accent-primary);
  color: var(--bg-primary);
  transform: translateY(-2px);
  box-shadow: var(--shadow-glow-green-strong);
}
```

### Creating a Status Card

```css
.status-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-xl);
  padding: var(--space-xl);
  box-shadow: 0 0 30px rgba(0, 255, 0, 0.1);
}

.status-card.error {
  border-color: var(--error);
  box-shadow: 0 0 30px rgba(255, 102, 102, 0.1);
}
```

### Adding Glow Effects

```css
.glowing-text {
  color: var(--accent-primary);
  text-shadow: var(--shadow-glow-green);
}

.glowing-border {
  border: 1px solid var(--accent-primary);
  box-shadow: var(--shadow-glow-green);
}
```

## 📝 Design Principles

1. **High Contrast:** Always ensure sufficient contrast between text and backgrounds
2. **Consistent Spacing:** Use the spacing scale for all margins and padding
3. **Monospace Typography:** Maintain the terminal/code aesthetic throughout
4. **Green Accent Usage:** Use sparingly for maximum impact
5. **Smooth Transitions:** Apply consistent 0.2s transitions for interactivity
6. **Glow Effects:** Use glows to enhance the futuristic feel without overdoing it
7. **Dark Theme First:** Design for dark theme as primary, light theme as exception
8. **Accessibility:** Ensure all interactive elements are keyboard accessible

This theme creates a professional, high-tech atmosphere perfect for AI/tech applications while maintaining excellent usability and accessibility standards.