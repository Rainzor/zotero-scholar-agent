export type CommandMenuItem = {
  command: string;
  description: string;
  template: string;
};

const COMMANDS: CommandMenuItem[] = [
  {
    command: "/note",
    description: "Organize Reader Thinking",
    template: "/note ",
  },
  {
    command: "/rate",
    description: "Set paper rating",
    template: "/rate ",
  },
  {
    command: "/depth",
    description: "Set L0, L1, or L2 depth",
    template: "/depth ",
  },
];

export function getCommandMenuItems(value: string): CommandMenuItem[] {
  const text = String(value || "");
  if (!text.startsWith("/") || /\s/.test(text)) return [];
  const query = text.toLowerCase();
  return COMMANDS.filter((item) => item.command.startsWith(query));
}

export function insertCommandTemplate(
  value: string,
  start: number,
  end: number,
  template: string,
): { value: string; cursor: number } {
  const before = String(value || "").slice(0, Math.max(0, start));
  const after = String(value || "").slice(Math.max(start, end));
  const next = `${before}${template}${after}`;
  return { value: next, cursor: before.length + template.length };
}
