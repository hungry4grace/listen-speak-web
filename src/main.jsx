import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import BlindScriptureApp from './BlindScriptureApp.jsx'
import PrivacyPage from './PrivacyPage.jsx'
import DeleteAccountPage from './DeleteAccountPage.jsx'

const RootApp = window.location.pathname.startsWith('/privacy')
  ? PrivacyPage
  : window.location.pathname.startsWith('/delete-account')
    ? DeleteAccountPage
    : window.location.pathname.startsWith('/blind')
      ? BlindScriptureApp
      : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootApp />
  </StrictMode>,
)
