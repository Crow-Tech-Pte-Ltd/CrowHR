import { Button, formatDate, Skeleton, toast } from "@crowhr/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMe } from "../auth/session.ts";
import { CopyField } from "../components/copy-field.tsx";
import { ErrorNote, Section } from "../components/section.tsx";
import { apiDelete, apiGet, apiPut } from "../lib/api.ts";

interface AssistantSettings {
  available: boolean;
  enabled: boolean;
  url: string | null;
}

interface AssistantConnection {
  id: string;
  provider: string;
  connectedAt: string;
}

export function AssistantDisclosure() {
  return (
    <p className="text-ui text-primary-300">
      Each person signs in to Crow HR and decides whether to share their annual leave balance, next published shift and
      pending approval count. Results can appear in their conversations with ChatGPT or Claude.
    </p>
  );
}

export function AssistantSettingsPanel({ company = false }: { company?: boolean }) {
  const me = useMe();
  const isDemo = me.demoMode || !!me.demoCompany;
  const configKey = ["assistant", me.organisation.id, "settings"];
  const connectionsKey = ["assistant", me.organisation.id, me.membershipId, "connections"];
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: configKey,
    queryFn: () => apiGet<AssistantSettings>("/api/v1/assistant/settings"),
    enabled: !isDemo,
  });
  const connections = useQuery({
    queryKey: connectionsKey,
    queryFn: () => apiGet<{ connections: AssistantConnection[] }>("/api/v1/assistant/connections"),
    enabled: !company && settings.data?.enabled === true,
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => apiPut<AssistantSettings>("/api/v1/assistant/settings", { enabled }),
    onSuccess: (data) => {
      qc.setQueryData(configKey, data);
      void qc.invalidateQueries({ queryKey: connectionsKey });
      toast(data.enabled ? "AI assistants enabled" : "AI assistants disconnected");
    },
  });
  const disconnect = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/assistant/connections/${encodeURIComponent(id)}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: connectionsKey });
      toast("Assistant disconnected");
    },
  });

  return (
    <Section id="ai-assistants" title="AI assistants">
      <div className="flex flex-col gap-4 p-4">
        {isDemo ? (
          <>
            <AssistantDisclosure />
            <p className="text-ui">Connections are disabled in the public demo.</p>
          </>
        ) : settings.isPending ? (
          <Skeleton className="h-7 w-1/2" />
        ) : settings.isError ? (
          <ErrorNote error={settings.error} retry={() => void settings.refetch()} />
        ) : !settings.data.available ? (
          <p className="text-ui text-primary-300">
            {company
              ? "To make this available, set AI_ASSISTANT_ENABLED=1 on your HTTPS Crow HR server and restart the app."
              : "Your Crow HR server has disabled AI assistant connections."}
          </p>
        ) : (
          <>
            <AssistantDisclosure />
            {settings.data.url ? (
              <>
                <CopyField label="Connector URL" value={settings.data.url} />
                <p className="text-ui text-primary-300">
                  Add this URL as a custom connector in your assistant. Choose OAuth and automatic registration in
                  Claude. When asked, sign in here and approve the connection.
                </p>
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-ui">
                  <li>
                    <a
                      className="text-biru-400 underline"
                      href="https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt"
                      target="_blank"
                      rel="noreferrer"
                    >
                      ChatGPT setup
                    </a>
                  </li>
                  <li>
                    <a
                      className="text-biru-400 underline"
                      href="https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Claude setup
                    </a>
                  </li>
                </ul>
              </>
            ) : (
              <p className="text-ui text-primary-300">AI assistant connections are off for this company.</p>
            )}
            {company ? (
              <div>
                <Button
                  type="button"
                  variant={settings.data.enabled ? "secondary" : "primary"}
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate(!settings.data.enabled)}
                >
                  {settings.data.enabled ? "Disable and disconnect all assistants" : "Enable AI assistants"}
                </Button>
                {toggle.isError ? <ErrorNote error={toggle.error} /> : null}
              </div>
            ) : settings.data.enabled ? (
              connections.isPending ? (
                <Skeleton className="h-9 w-2/3" />
              ) : connections.isError ? (
                <ErrorNote error={connections.error} retry={() => void connections.refetch()} />
              ) : connections.data.connections.length ? (
                <ul className="divide-y divide-border border-y border-border">
                  {connections.data.connections.map((connection) => (
                    <li key={connection.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="text-ui">
                        {connection.provider}{" "}
                        <span className="text-primary-300">· {formatDate(connection.connectedAt.slice(0, 10))}</span>
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        type="button"
                        disabled={disconnect.isPending}
                        onClick={() => disconnect.mutate(connection.id)}
                        aria-label={`Disconnect ${connection.provider}`}
                      >
                        Disconnect
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-ui">You have no connected assistants.</p>
              )
            ) : null}
            {disconnect.isError ? <ErrorNote error={disconnect.error} /> : null}
          </>
        )}
      </div>
    </Section>
  );
}
