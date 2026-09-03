import { createRoot } from 'react-dom/client'
import { DashboardApp } from './dashboard-app'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(<DashboardApp />)
}
