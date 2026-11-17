import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

import { ErrorState } from '../components/ui/ErrorState'

type ErrorBoundaryProps = { children: ReactNode }
type ErrorBoundaryState = { hasError: boolean }

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI rendering error', { error, componentStack: info.componentStack })
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorState
          description="Refresh the page to continue. If the issue persists, contact your administrator."
          onRetry={() => window.location.reload()}
        />
      )
    }
    return this.props.children
  }
}
