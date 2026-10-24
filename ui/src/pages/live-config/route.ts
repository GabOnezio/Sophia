import { definePage } from "@openclaw/uirouter";
import { html } from "lit";
import type { ApplicationContext } from "../../app/context.ts";

async function loadLiveConfigRoute(context: ApplicationContext): Promise<void> {
  await Promise.all([context.runtimeConfig.ensureLoaded(), context.agents.ensureList()]);
}

export const page = definePage({
  id: "live-config",
  path: "/settings/live-configuration",
  aliases: ["/live-config"],
  loader: loadLiveConfigRoute,
  component: () =>
    import("./live-config-page.ts").then(() => ({
      header: true,
      render: () => html`<openclaw-live-config-page></openclaw-live-config-page>`,
    })),
});
