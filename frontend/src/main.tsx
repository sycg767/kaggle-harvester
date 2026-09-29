import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App as AntApp, ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import '@fontsource-variable/public-sans';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

ReactDOM.createRoot(rootElement).render(
  <ConfigProvider
    locale={zhCN}
    theme={{
      algorithm: theme.defaultAlgorithm,
      token: {
        colorPrimary: '#1677ff',
        colorInfo: '#1677ff',
        colorSuccess: '#10b981',
        colorWarning: '#f59e0b',
        colorError: '#ef4444',
        colorText: '#1e293b',
        colorTextSecondary: '#64748b',
        colorBorder: '#e2e8f0',
        colorBorderSecondary: '#f1f5f9',
        colorBgLayout: '#f8fafc',
        colorBgContainer: '#ffffff',
        colorFillAlter: '#f8fafc',
        borderRadius: 8,
        borderRadiusLG: 10,
        controlHeight: 34,
        fontFamily: "'Public Sans Variable', 'Public Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        fontSize: 14,
      },
      components: {
        Button: {
          borderRadius: 8,
          borderRadiusSM: 6,
          controlHeight: 34,
          controlHeightSM: 28,
          defaultShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
          primaryShadow: '0 1px 2px rgba(22, 119, 255, 0.15)',
        },
        Card: {
          borderRadiusLG: 10,
          boxShadowTertiary: 'none',
          headerBg: '#ffffff',
        },
        Table: {
          borderColor: '#e2e8f0',
          headerBg: '#f8fafc',
          headerColor: '#1e293b',
          headerSplitColor: 'transparent',
          rowHoverBg: '#f8fafc',
          cellPaddingBlock: 10,
          cellPaddingInline: 12,
        },
        Menu: {
          itemBg: 'transparent',
          itemSelectedBg: '#eff6ff',
          itemSelectedColor: '#1677ff',
          itemBorderRadius: 6,
        },
        Modal: {
          borderRadiusLG: 12,
          titleFontSize: 16,
        },
        Drawer: {
          colorBgElevated: '#ffffff',
        },
        Input: { activeShadow: '0 0 0 3px rgba(22, 119, 255, 0.12)' },
        Select: {
          activeOutlineColor: 'rgba(22, 119, 255, 0.12)',
          optionSelectedBg: '#eff6ff',
          optionSelectedColor: '#1677ff',
        },
      },
    }}
  >
    <AntApp>
      <BrowserRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </BrowserRouter>
    </AntApp>
  </ConfigProvider>
);
