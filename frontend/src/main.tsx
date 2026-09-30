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
        colorPrimary: '#007aff',
        colorInfo: '#007aff',
        colorSuccess: '#34c759',
        colorWarning: '#ff9500',
        colorError: '#ff3b30',
        colorText: '#1c1c1e',
        colorTextSecondary: '#6e6e73',
        colorBorder: 'rgba(60, 60, 67, 0.12)',
        colorBorderSecondary: 'rgba(60, 60, 67, 0.08)',
        colorBgLayout: '#f2f2f7',
        colorBgContainer: '#ffffff',
        colorFillAlter: 'rgba(118, 118, 128, 0.06)',
        borderRadius: 12,
        borderRadiusLG: 20,
        controlHeight: 36,
        fontFamily:
          '"Public Sans", -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "PingFang SC", "Microsoft YaHei", sans-serif',
        fontSize: 14,
      },
      components: {
        Button: {
          borderRadius: 12,
          borderRadiusSM: 10,
          controlHeight: 36,
          controlHeightSM: 30,
          defaultShadow: 'none',
          primaryShadow: '0 2px 6px rgba(0, 122, 255, 0.12)',
        },
        Card: {
          borderRadiusLG: 20,
          boxShadowTertiary: '0 14px 34px rgba(26, 29, 36, 0.055), 0 2px 8px rgba(26, 29, 36, 0.025)',
          headerBg: '#ffffff',
        },
        Table: {
          borderColor: 'rgba(60, 60, 67, 0.10)',
          headerBg: 'rgba(247, 247, 249, 0.85)',
          headerColor: '#1c1c1e',
          headerSplitColor: 'transparent',
          rowHoverBg: 'rgba(118, 118, 128, 0.05)',
          cellPaddingBlock: 10,
          cellPaddingInline: 12,
        },
        Menu: {
          itemBg: 'transparent',
          itemSelectedBg: 'rgba(0, 122, 255, 0.10)',
          itemSelectedColor: '#007aff',
          itemBorderRadius: 10,
        },
        Modal: {
          borderRadiusLG: 20,
          titleFontSize: 16,
        },
        Drawer: {
          colorBgElevated: '#ffffff',
        },
        Input: {
          borderRadius: 12,
          activeShadow: '0 0 0 3px rgba(0, 122, 255, 0.15)',
        },
        Select: {
          borderRadius: 12,
          activeOutlineColor: 'rgba(0, 122, 255, 0.15)',
          optionSelectedBg: 'rgba(0, 122, 255, 0.10)',
          optionSelectedColor: '#007aff',
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
