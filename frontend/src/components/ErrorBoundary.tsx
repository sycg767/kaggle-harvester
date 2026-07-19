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

  private reset = () => {
    this.setState({ error: null });
    window.location.assign('/kernels');
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal-error-shell" role="alert">
        <Result
          status="error"
          title="页面暂时无法显示"
          subTitle="数据和本地归档不会受影响。可以返回 Kernel 广场重新加载界面。"
          extra={<Button type="primary" onClick={this.reset}>返回 Kernel 广场</Button>}
        />
      </main>
    );
  }
}

export default ErrorBoundary;

