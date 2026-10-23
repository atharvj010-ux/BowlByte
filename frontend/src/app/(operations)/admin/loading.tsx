export default function AdminLoading() {
  return (
    <div className="mgr-page" aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading this section.</p>
      <span className="mgr-skel mgr-skel-title" aria-hidden="true" />
      <span className="mgr-skel mgr-skel-line" aria-hidden="true" />
      <div className="mgr-stats" aria-hidden="true">
        <span className="mgr-skel mgr-skel-tile" />
        <span className="mgr-skel mgr-skel-tile" />
        <span className="mgr-skel mgr-skel-tile" />
        <span className="mgr-skel mgr-skel-tile" />
      </div>
      <span className="mgr-skel mgr-skel-block" aria-hidden="true" />
    </div>
  );
}
