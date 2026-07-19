import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Spin } from 'antd';

const AppLayout = lazy(() => import('./components/AppLayout'));
const KernelList = lazy(() => import('./components/KernelList'));
const ArchiveManager = lazy(() => import('./components/ArchiveManager'));

const App: React.FC = () => {
  return (
    <Suspense
      fallback={
        <div style={{ display: 'grid', minHeight: '100vh', placeItems: 'center' }}>
          <Spin size="large" />
        </div>
      }
    >
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<Navigate to="/kernels" replace />} />
          <Route path="kernels" element={<KernelList />} />
          <Route path="archives" element={<ArchiveManager />} />
          <Route path="*" element={<Navigate to="/kernels" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
};

export default App;
