import './assets/main.css'

import { createRoot } from 'react-dom/client'
import App from './App'
import { applyTheme, currentTheme, loadPrefs } from './lib/prefs'

// Before the first render, so a light theme doesn't flash dark on startup.
applyTheme(currentTheme(loadPrefs()))

// No StrictMode: its double-mount in dev would open every SSH session twice.
createRoot(document.getElementById('root')!).render(<App />)
