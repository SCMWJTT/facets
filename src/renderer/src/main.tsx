import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './styles.css'
import { App } from './App'
import { useStore } from './store'

// Exposed for the automated screenshot checks.
;(window as unknown as { __facets: typeof useStore }).__facets = useStore

createRoot(document.getElementById('root')!).render(<App />)
