import React, { lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/AppLayout';

const Dashboard = lazy(() => import('./components/Dashboard'));
const SimulationArena = lazy(() => import('./components/SimulationArena'));
const KernelList = lazy(() => import('./components/KernelList'));
const ArchiveManager = lazy(() => import('./components/ArchiveManager'));

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="arena" element={<SimulationArena />} />
        <Route path="kernels" element={<KernelList />} />
        <Route path="archives" element={<ArchiveManager />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
};

export default App;
