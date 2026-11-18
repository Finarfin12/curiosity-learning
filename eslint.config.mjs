import obsidian from "eslint-plugin-obsidianmd";

export default [
  { ignores: ["main.js", "node_modules/**", "test-vault/**", "coverage/**"] },
  ...obsidian.configs.recommended,
  { files: ["**/*.ts"], languageOptions: { parserOptions: { projectService: true } } },
  {
    files: ["tests/**/*.ts"],
    rules: { "import/no-nodejs-modules": "off", "obsidianmd/no-tfile-tfolder-cast": "off" },
  },
];
