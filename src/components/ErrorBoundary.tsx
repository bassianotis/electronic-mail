import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null
    };

    public static getDerivedStateFromError(error: Error): State {
        // Update state so the next render will show the fallback UI.
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
    }

    public render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100vh',
                    padding: '20px',
                    backgroundColor: '#f8f9fa',
                    color: '#333',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                }}>
                    <h1 style={{ fontSize: '24px', marginBottom: '16px', color: '#e03131' }}>Something went wrong</h1>
                    <p style={{ marginBottom: '24px', color: '#666' }}>
                        We're sorry, but the application encountered an unexpected error.
                    </p>
                    <div style={{
                        padding: '16px',
                        backgroundColor: '#fff',
                        borderRadius: '8px',
                        border: '1px solid #ddd',
                        marginBottom: '24px',
                        maxWidth: '600px',
                        width: '100%',
                        overflow: 'auto',
                        maxHeight: '200px',
                        fontFamily: 'monospace',
                        fontSize: '12px'
                    }}>
                        {this.state.error?.message}
                    </div>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            padding: '10px 20px',
                            backgroundColor: '#228be6',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '14px',
                            fontWeight: 600,
                            cursor: 'pointer'
                        }}
                    >
                        Reload Application
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
