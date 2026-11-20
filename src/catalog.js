// One-click apps = MCP servers that run on this computer (need Node.js; fetched with npx on first use).
// Categories match the filter pills in the Connect Apps window.
const env = (key, label) => ({ key, label, secret: true, kind: 'env' });
export const CATALOG = [
  { slug: 'browser', name: 'Browser', description: 'Open pages, click, type and read websites in a real browser.', categories: ['productivity', 'developer tools'], command: 'npx', args: ['-y', '@playwright/mcp@latest'], fields: [] },
  { slug: 'filesystem', name: 'Files', description: 'Read and edit files in a folder you choose.', categories: ['productivity', 'developer tools'], command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '{folder}'], fields: [{ key: 'folder', label: 'Folder path', secret: false, kind: 'arg' }] },
  { slug: 'github', name: 'GitHub', description: 'Repos, issues and pull requests.', categories: ['developer tools'], command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], fields: [env('GITHUB_PERSONAL_ACCESS_TOKEN', 'Personal access token')] },
  { slug: 'slack', name: 'Slack', description: 'Read and post messages in your Slack workspace.', categories: ['communication'], command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'], fields: [env('SLACK_BOT_TOKEN', 'Bot token (xoxb-…)'), { key: 'SLACK_TEAM_ID', label: 'Team ID', secret: false, kind: 'env' }] },
  { slug: 'notion', name: 'Notion', description: 'Search and edit pages and databases.', categories: ['productivity'], command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], fields: [env('NOTION_TOKEN', 'Integration token')] },
  { slug: 'docs', name: 'Code docs', description: 'Up-to-date documentation for libraries and frameworks.', categories: ['developer tools'], command: 'npx', args: ['-y', '@upstash/context7-mcp'], fields: [] },
  { slug: 'brave', name: 'Brave Search', description: 'Web search with a free API key.', categories: ['productivity'], command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'], fields: [env('BRAVE_API_KEY', 'API key')] },
  { slug: 'maps', name: 'Google Maps', description: 'Places, directions and distances.', categories: ['productivity'], command: 'npx', args: ['-y', '@modelcontextprotocol/server-google-maps'], fields: [env('GOOGLE_MAPS_API_KEY', 'API key')] },
  { slug: 'figma', name: 'Figma', description: 'Read designs from Figma files.', categories: ['images & design'], command: 'npx', args: ['-y', 'figma-developer-mcp', '--stdio'], fields: [env('FIGMA_API_KEY', 'Personal access token')] },
];

// How to start the server for a catalog entry (or a custom MCP app) given the user's values.
export function specFor(app, values = {}) {
  const sub = (s) => s.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');
  const envs = {};
  for (const f of app.fields || []) if (f.kind === 'env' && values[f.key]) envs[f.key] = values[f.key];
  return { command: app.command, args: (app.args || []).map(sub), env: envs };
}
