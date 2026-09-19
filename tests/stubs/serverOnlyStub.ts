/**
 * "server-only" npm packageのVitest専用test-environment adapter
 * (2026-09-08のユーザー指示)。
 *
 * 実際の"server-only" package(node_modules/server-only/index.js)は、
 * `typeof window !== "undefined"`の場合にthrowするNext.js公式のpoison-pill
 * packageである。これはNext.jsのServer Component compilerがclient bundleへの
 * 誤混入を検知するためのものであり、Vitestという非Next.jsコンパイラ環境で実行
 * すると、vitest.config.tsの`test.environment`設定(現在"node")によっては
 * 意図せずthrow条件を満たしてしまう場合がある。
 *
 * このstubはVitestの`resolve.alias`(vitest.config.tsのみ。Next.js本体の
 * webpack/turbopack設定には一切適用しない)を通じてのみ使われ、
 * production build/実行時には一切読み込まれない。
 *
 * production側の`import "server-only";`文そのものは削除しない
 * (openAiSdkTransport.ts / aiMeasurementConfig.ts /
 * aiMeasurementProviderFactory.ts、いずれも無変更)。このstubは
 * Vitestにとっての「安全な代替解決先」を提供するだけであり、
 * server-only境界(誤ったclient importの検知)自体を弱めるものではない。
 */
export {};
