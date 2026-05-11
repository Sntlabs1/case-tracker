import { Component } from "react";

// Catches render-time exceptions in any tab component so a single bug in one
// tab can't blank the entire app. Each tab in App.jsx is wrapped individually
// — switching tabs resets the boundary via the `resetKey` prop change.

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info);
  }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 28, borderRadius: 14,
          background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.30)",
          color: "var(--text-2)", maxWidth: 720,
        }}>
          <div style={{
            fontSize: 11, color: "#ef4444", letterSpacing: "0.16em",
            textTransform: "uppercase", fontWeight: 700, marginBottom: 8,
          }}>
            Tab Crashed
          </div>
          <div style={{ fontSize: 14, marginBottom: 12, fontWeight: 600 }}>
            This tab hit a render error. The rest of the app is still usable —
            switch to another tab and back, or refresh the page.
          </div>
          <pre style={{
            fontSize: 11, lineHeight: 1.5, padding: 12,
            background: "rgba(0,0,0,0.25)", borderRadius: 8,
            color: "var(--text-3)", overflow: "auto", maxHeight: 200,
            margin: 0, fontFamily: "ui-monospace, Menlo, monospace",
          }}>
            {String(this.state.error?.message || this.state.error)}
            {this.state.error?.stack ? "\n\n" + this.state.error.stack : ""}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
