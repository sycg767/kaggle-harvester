import React from 'react';
import { Button, Result } from 'antd';

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('页面渲染失败', error, info.componentStack);
  }

  private reloadCurrentPage = () => {
    window.location.reload();
  };

  private goToDashboard = () => {
    window.location.assign('/dashboard');
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal-error-shell" role="alert">
        <Result
          status="error"
          title="当前页面暂时无法显示"
          subTitle={`当前地址：${window.location.pathname}。数据和本地归档不会受影响，请先尝试重新加载当前页面。`}
          extra={(
            <>
              <Button type="primary" onClick={this.reloadCurrentPage}>重新加载当前页</Button>
              <Button onClick={this.goToDashboard}>返回竞赛工作台</Button>
            </>
          )}
        />
      </main>
    );
  }
}

export default ErrorBoundary;

