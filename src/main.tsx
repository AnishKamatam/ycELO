import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import Vote from './pages/Vote.tsx'
import Leaderboard from './pages/Leaderboard.tsx'

const router = createBrowserRouter([
  { path: '/', element: <Vote /> },
  { path: '/leaderboard', element: <Leaderboard /> },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
