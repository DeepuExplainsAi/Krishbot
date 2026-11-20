// One-click MCP servers that run on this computer (need Node.js installed; fetched with npx on first use).
export const CATALOG = [
  { key: 'browser', label: 'Browser control (Playwright, Apache-2.0)', command: 'npx', args: ['-y', '@playwright/mcp@latest'], env: [] },
  { key: 'filesystem', label: 'Files in a folder (MIT)', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '{folder}'], env: [], ask: ['folder'] },
  { key: 'memory', label: 'Knowledge-graph memory (MIT)', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], env: [] },
  { key: 'thinking', label: 'Step-by-step thinking (MIT)', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'], env: [] },
  { key: 'github', label: 'GitHub (MIT)', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: ['GITHUB_PERSONAL_ACCESS_TOKEN'] },
  { key: 'slack', label: 'Slack (MIT)', command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'], env: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'] },
  { key: 'notion', label: 'Notion (MIT)', command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], env: ['NOTION_TOKEN'] },
];
