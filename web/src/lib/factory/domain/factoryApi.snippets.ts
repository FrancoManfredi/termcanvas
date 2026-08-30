// Factory API snippets — SRP: copyable examples for the API console.
// Source: WarpFactories.md §19 · US-155

export interface ApiSnippet {
  readonly id: "curl-list" | "curl-run" | "python-run";
  readonly label: string;
  readonly language: "bash" | "python";
  readonly code: string;
}

export const FACTORY_API_SNIPPETS: readonly ApiSnippet[] = [
  {
    id: "curl-list",
    label: "Listar factories",
    language: "bash",
    code: 'curl -H "Authorization: Bearer $API_KEY" https://app.warp.dev/api/v1/factory?search=payments',
  },
  {
    id: "curl-run",
    label: "Crear un run",
    language: "bash",
    code: 'curl -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \\\n  -d \'{"prompt":"Fix checkout race","ticket_ref":"linear:PAY-123"}\' \\\n  https://app.warp.dev/api/v1/factory/$UID/runs',
  },
  {
    id: "python-run",
    label: "Usar OzAPI",
    language: "python",
    code: 'from oz_agent_sdk import OzAPI\nclient = OzAPI(api_key="...")\nrun = client.factories.runs.create(uid, prompt="Fix checkout race", ticket_ref="linear:PAY-123")',
  },
];
