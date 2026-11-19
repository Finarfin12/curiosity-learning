import obsidian from "eslint-plugin-obsidianmd";

export default [
  { ignores: ["main.js", "node_modules/**", "test-vault/**", "coverage/**"] },
  ...obsidian.configs.recommended,
  {
    rules: {
      "preserve-caught-error": "error",
      "obsidianmd/prefer-create-el": "error",
      "obsidianmd/settings-tab/prefer-setting-definitions": "error",
    },
  },
  { files: ["**/*.ts"], languageOptions: { parserOptions: { projectService: true } } },
  {
    files: ["tests/**/*.ts"],
    rules: { "import/no-nodejs-modules": "off", "obsidianmd/no-tfile-tfolder-cast": "off" },
  },
];
