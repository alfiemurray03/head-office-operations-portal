// Compatibility entry point for staff browsers holding an older cached portal page.
// The current index loads these production modules directly.
const productionModules = [
  "/js/core.js?v=20260728-production-2",
  "/js/views-operations.js?v=20260728-production-2",
  "/js/views-control.js?v=20260728-production-2",
  "/js/modals.js?v=20260728-production-2",
  "/js/actions.js?v=20260728-production-2",
  "/js/boot.js?v=20260728-production-2"
];

for (const source of productionModules) {
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = source;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`The production portal client could not load ${source}.`));
    document.head.append(script);
  });
}
