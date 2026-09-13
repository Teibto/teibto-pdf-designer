<!-- @author Wichit Wongta -->
<!-- @since 2026-09-13 -->

# Production performance checks

Run `npx playwright test --config playwright.performance.config.ts` from `designer`
after building the web bundle. For the existing inline NetSuite bundle, use
`playwright.netsuite-performance.config.ts`; this measures the local deployed bundle
with mocked responses, not native NetSuite server latency.

Timed runs disable Playwright tracing by default. Snapshot recording adds work inside
the measured phases: private profiling observed approximately 20–47 ms of recorder
work. It was not the sole cause of long tasks, so the performance budgets are unchanged.
Raw record-load JSON attachments remain available, and failures retain screenshots
captured after the test's measured intervals.

For a diagnostic run in PowerShell, set `$env:PLD_PERF_TRACE = '1'` before the same
command. This records traces and retains them on failure for either configuration.
Remove the setting with `Remove-Item Env:PLD_PERF_TRACE` before running timing gates.
Traced results include recorder overhead and should not be used for normal performance
comparisons. Disabling that instrumentation is a measurement correction, not a product
speedup.
