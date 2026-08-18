export interface ColorToken {
  name: string;
  variable: string;
  darkValue: string;
  lightValue: string;
  description: string;
}

export const REPO_CONTEXT_PALETTE: ColorToken[] = [
  {
    name: "Background",
    variable: "--bg",
    darkValue: "#1a1918",
    lightValue: "#eae8e4",
    description: "Main application/canvas background",
  },
  {
    name: "Sidebar",
    variable: "--sidebar",
    darkValue: "#141312",
    lightValue: "#e2e0dc",
    description: "Sidebar and secondary panel background",
  },
  {
    name: "Sidebar Hover",
    variable: "--sidebar-hover",
    darkValue: "#1c1b1a",
    lightValue: "#dbd9d5",
    description: "Hover state for sidebar items",
  },
  {
    name: "Surface",
    variable: "--surface",
    darkValue: "#222120",
    lightValue: "#f3f2ef",
    description: "Card, input, and container surface background",
  },
  {
    name: "Surface Hover",
    variable: "--surface-hover",
    darkValue: "#2a2928",
    lightValue: "#e5e3df",
    description: "Hover background for surface elements",
  },
  {
    name: "Border",
    variable: "--border",
    darkValue: "#333231",
    lightValue: "#dbd8d3",
    description: "Default hairline border rule",
  },
  {
    name: "Border Hover",
    variable: "--border-hover",
    darkValue: "#43423f",
    lightValue: "#c9c5bf",
    description: "Emphasized or hovered border rule",
  },
  {
    name: "Text Primary",
    variable: "--text-primary",
    darkValue: "#e4e2df",
    lightValue: "#1c1917",
    description: "High-contrast primary body and header text",
  },
  {
    name: "Text Secondary",
    variable: "--text-secondary",
    darkValue: "#918e89",
    lightValue: "#57534e",
    description: "Medium-contrast secondary text and subheadings",
  },
  {
    name: "Text Muted",
    variable: "--text-muted",
    darkValue: "#7a7773",
    lightValue: "#6b6660",
    description: "Low-contrast captions and muted indicators",
  },
  {
    name: "Text Faint",
    variable: "--text-faint",
    darkValue: "#3e3c39",
    lightValue: "#c4c0ba",
    description: "Extra muted labels, eyebrows, and disabled indicators",
  },
  {
    name: "Text Metadata",
    variable: "--text-metadata",
    darkValue: "#a8a59f",
    lightValue: "#4a4540",
    description: "Monospace and metadata details",
  },
  {
    name: "Accent",
    variable: "--accent",
    darkValue: "#c4c0b8",
    lightValue: "#44403c",
    description: "Primary accent fill and links",
  },
  {
    name: "Accent Foreground",
    variable: "--accent-foreground",
    darkValue: "#1a1918",
    lightValue: "#f3f2ef",
    description: "Text color rendered on top of accent fills",
  },
  {
    name: "Red (Danger)",
    variable: "--red",
    darkValue: "#e87272",
    lightValue: "#dc2626",
    description: "Destructive actions and high gravity warnings",
  },
  {
    name: "Amber (Warning)",
    variable: "--amber",
    darkValue: "#d4a24e",
    lightValue: "#d97706",
    description: "Inconsistencies and critical uncertainty warnings",
  },
];
