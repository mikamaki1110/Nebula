import { useEffect } from 'react'
import { CommandBar } from './components/CommandBar'
import { ConfirmDialog } from './components/ConfirmDialog'
import { PromptDialog } from './components/PromptDialog'
import { Sidebar } from './components/Sidebar'
import { Splash } from './components/Splash'
import { Toasts } from './components/Toasts'
import { Topbar } from './components/Topbar'
import { Chat } from './pages/Chat'
import { Dashboard } from './pages/Dashboard'
import { Files } from './pages/Files'
import { History } from './pages/History'
import { Monitor } from './pages/Monitor'
import { Optimize } from './pages/Optimize'
import { Programs } from './pages/Programs'
import { Repair } from './pages/Repair'
import { Security } from './pages/Security'
import { Settings } from './pages/Settings'
import { Storage } from './pages/Storage'
import { AppProvider, useApp } from './state/app'
import { ChatProvider, useChat } from './state/chat'
import { LiveProvider, useLive } from './state/live'
import { ReportsProvider } from './state/reports'

const PAGES = {
  dashboard: Dashboard, chat: Chat, monitor: Monitor, storage: Storage, programs: Programs, security: Security,
  optimize: Optimize, repair: Repair, files: Files, settings: Settings, history: History
}

/** Überträgt Akzentfarbe, Dichte und Effekte als Attribute aufs Wurzelelement. */
function useTheme(): void {
  const { settings } = useChat()
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement.dataset
    root['accent'] = settings.accent
    root['density'] = settings.density
    root['effects'] = settings.effects ? 'on' : 'off'
  }, [settings])
}

function Shell(): JSX.Element {
  const { page } = useApp()
  const { data } = useLive()
  useTheme()
  const Page = PAGES[page]
  return (
    <div className="shell">
      <Sidebar />
      <div className="stage">
        <Topbar />
        <main className={`content content-${page}`} key={page}><Page /></main>
      </div>
      <ConfirmDialog />
      <PromptDialog />
      <CommandBar />
      <Toasts />
      <Splash ready={!!data} />
    </div>
  )
}

export function App(): JSX.Element {
  return (
    <AppProvider>
      <LiveProvider>
        <ChatProvider>
          <ReportsProvider>
            <Shell />
          </ReportsProvider>
        </ChatProvider>
      </LiveProvider>
    </AppProvider>
  )
}
