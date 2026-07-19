import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider, theme } from 'antd';
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
        colorPrimary: '#0a0a0a',
        colorInfo: '#4a9ccf',
        colorSuccess: '#16a17a',
        colorWarning: '#b7791f',
        colorError: '#dc2626',
        colorText: '#070707',
        colorTextSecondary: '#686868',
        colorBorder: '#eaeaea',
        colorBorderSecondary: '#ededed',
        colorBgLayout: '#f7f7f7',
        colorBgContainer: '#ffffff',
        colorFillAlter: '#f6f6f6',
        borderRadius: 16,
        borderRadiusLG: 22,
        controlHeight: 32,
        fontFamily: "'Public Sans Variable', 'Public Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        fontSize: 14,
      },
      components: {
        Button: {
          borderRadius: 16,
          borderRadiusSM: 13,
          controlHeight: 32,
          controlHeightSM: 28,
          defaultShadow: 'none',
          primaryShadow: 'none',
        },
        Card: {
          borderRadiusLG: 22,
          boxShadowTertiary: 'none',
          headerBg: '#ffffff',
        },
        Table: {
          borderColor: '#ededed',
          headerBg: '#ffffff',
          headerColor: '#0a0a0a',
          headerSplitColor: 'transparent',
          rowHoverBg: '#f8f8f8',
          cellPaddingBlock: 8,
          cellPaddingInline: 8,
        },
        Menu: {
          itemBg: 'transparent',
          itemSelectedBg: '#e5e5e5',
          itemSelectedColor: '#0a0a0a',
          itemBorderRadius: 13,
        },
        Modal: {
          borderRadiusLG: 22,
          titleFontSize: 16,
        },
        Drawer: {
          colorBgElevated: '#ffffff',
        },
        Input: { activeShadow: '0 0 0 3px rgba(0, 0, 0, 0.08)' },
        Select: { activeOutlineColor: 'rgba(0, 0, 0, 0.08)' },
        Switch: { colorPrimary: '#0a0a0a', colorPrimaryHover: '#2a2a2a' },
      },
    }}
  >
    <BrowserRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </ConfigProvider>
);
