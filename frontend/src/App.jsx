import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Consent from './pages/Consent.jsx'
import Interview from './pages/Interview.jsx'
import Finish from './pages/Finish.jsx'
import Doctor from './pages/Doctor.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Interview />} />
        <Route path="/consent" element={<Consent />} />
        <Route path="/interview" element={<Interview />} />
        <Route path="/finish" element={<Finish />} />
        <Route path="/doctor/:sessionId" element={<Doctor />} />
      </Routes>
    </BrowserRouter>
  )
}
