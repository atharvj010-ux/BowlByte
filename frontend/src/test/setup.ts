import "@testing-library/jest-dom/vitest";

if (!("IntersectionObserver" in globalThis)) {
  class NoopIntersectionObserver {
    readonly root = null;
    readonly rootMargin = "0px";
    readonly thresholds = [0];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  globalThis.IntersectionObserver = NoopIntersectionObserver as unknown as typeof IntersectionObserver;
}
