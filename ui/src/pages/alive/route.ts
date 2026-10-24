import { definePage } from "@openclaw/uirouter";
import { html } from "lit";
import type { ApplicationContext } from "../../app/context.ts";

async function loadAliveRoute(context: ApplicationContext): Promise<void> {
  await Promise.all([context.runtimeConfig.ensureLoaded(), context.agents.ensureList()]);
}

export const page = definePage({
  id: "alive",
  path: "/alive",
  loader: loadAliveRoute,
  component: () =>
    import("./alive-page.ts").then(() => ({
      header: true,
      render: () => html`<openclaw-alive-page></openclaw-alive-page>`,
    })),
});
