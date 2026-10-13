import { CapacityGrid } from "./CapacityGrid";

export function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="Capacity home">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          capacity<span className="brand-period">.</span>
        </a>
        <span className="header-context">Team planning</span>
      </header>
      <main>
        <div className="page-title">
          <div>
            <p className="eyebrow">TEAM OVERVIEW</p>
            <h1>Team capacity</h1>
            <p>See who has room, and where the workload needs a closer look.</p>
          </div>
          <span className="page-badge">
            <span /> Weekly planning
          </span>
        </div>
        <CapacityGrid from="2025-12-29" to="2026-01-16" />
      </main>
      <footer className="app-footer">
        <span>Capacity · Team overview</span>
        <span>Plan with the whole team in view.</span>
      </footer>
    </div>
  );
}
